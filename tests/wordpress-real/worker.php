<?php
// Only the disposable local installation created by run-wordpress-real.mjs.
$root = getenv('SMA_WP_FIXTURE');
if (!$root || !is_file($root . '/sma-test-fixture') || !is_file($root . '/wordpress/wp-config.php')) {
    fwrite(STDERR, "Disposable SMA fixture required.\n"); exit(1);
}
$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
set_exception_handler(function($error) { fwrite(STDERR, get_class($error) . ': ' . $error->getMessage() . "\n" . $error->getTraceAsString()); exit(1); });
$_SERVER['HTTP_HOST'] = 'sma-wordpress.test';
$_SERVER['SERVER_NAME'] = 'sma-wordpress.test';
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['HTTPS'] = 'on'; // REST dispatch in-process; this is not a TLS test.
if ($input['operation'] === 'install') define('WP_INSTALLING', true);
require $root . '/wordpress/wp-load.php';
if (wp_get_environment_type() !== 'local' || DB_NAME !== 'sma_wp_test' || WP_HOME !== 'https://sma-wordpress.test') {
    throw new RuntimeException('Wrong fixture');
}
require_once ABSPATH . 'wp-admin/includes/plugin.php';
function reply($data) { echo json_encode($data, JSON_THROW_ON_ERROR) . "\n"; }
function dispatch($command) {
    $request = new WP_REST_Request('POST', '/sma-bridge/v1/command');
    $request->set_body($command['body']);
    $request->set_header('X-SMA-Signature', $command['headers']['X-SMA-Signature'] ?? '');
    $response = rest_do_request($request);
    return ['status' => $response->get_status(), 'data' => $response->get_data()];
}
if ($input['operation'] === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('SMA disposable test', 'sma_fixture_admin', 'fixture@example.invalid', false, '', bin2hex(random_bytes(24)));
    wp_installing(false);
    if (home_url('/') !== 'https://sma-wordpress.test/') throw new RuntimeException('Wrong installed URL');
    // Remove WordPress sample content; no content is served by an HTTP listener.
    foreach (get_posts(['post_type' => 'any', 'post_status' => 'any', 'numberposts' => -1]) as $post) wp_delete_post($post->ID, true);
    $error = activate_plugin('sma-bridge/sma-bridge.php');
    if (is_wp_error($error)) throw new RuntimeException($error->get_error_message());
    $foreign = wp_insert_post(['post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'Existing fixture page', 'post_content' => 'Do not change.'], true);
    if (is_wp_error($foreign)) throw new RuntimeException('Fixture page failed');
    update_option('sma_fixture_foreign', (int)$foreign);
    global $wpdb, $wp_version;
    reply(['wordpress' => $wp_version, 'php' => PHP_VERSION, 'database' => $wpdb->get_var('SELECT VERSION()'), 'foreign_id' => $foreign]);
    exit;
}
if (in_array($input['operation'], ['consent_form', 'submit_consent'], true)) {
    require __DIR__ . '/consent.php';
    exit;
}
if ($input['operation'] === 'command') {
    if (!empty($input['hold'])) {
        add_filter('wp_insert_post_data', function($data) use ($root) {
            if ($data['post_type'] === 'page' && $data['post_title'] === 'Produkte') {
                file_put_contents($root . '/locked', '1');
                $deadline = microtime(true) + 10;
                while (!is_file($root . '/release')) {
                    if (microtime(true) > $deadline) throw new RuntimeException('Lock test release timed out');
                    usleep(10000);
                }
            }
            return $data;
        });
    }
    reply(dispatch($input['command'])); exit;
}
if ($input['operation'] !== 'scenarios') throw new RuntimeException('Unknown fixture operation');
$passed = [];
function check($condition, $name) {
    global $passed;
    if (!$condition) throw new RuntimeException('FAILED: ' . $name);
    $passed[] = $name;
}
function rejected($command, $code) {
    $result = dispatch($command);
    check($result['status'] >= 400 && ($result['data']['code'] ?? null) === $code, 'Reject ' . $code);
}
global $wpdb;
$store = sma_bridge_store();
$state = $store->load();
$id = $state['post_id'];
$commands = $input['commands'];
$foreign = get_post((int)get_option('sma_fixture_foreign'), ARRAY_A);
check($state['revision'] === 1 && is_int($id), 'Concurrent identical requests leave revision 1');
check((int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='page' AND post_title='Produkte'") === 1, 'Exactly one product page');
check(get_post_status($id) === 'draft', 'Product page stays a draft');
$before = $store->load();
$inspect = dispatch($commands['inspect']);
check($inspect['status'] === 200 && $inspect['data']['can_publish'] === false && $store->load() === $before, 'Inspect cannot write or publish');
rejected($commands['unsigned'], 'sma_not_authorized');
rejected($commands['tampered'], 'sma_not_authorized');
$_SERVER['HTTPS'] = 'off';
rejected($commands['inspect'], 'sma_https_required');
$_SERVER['HTTPS'] = 'on';
check($store->load() === $before, 'Rejected transport/auth requests leave storage unchanged');
$replay = dispatch($commands['replay']);
check($replay['status'] === 200 && $replay['data']['post_id'] === $id && $replay['data']['revision'] === 1, 'Fresh signature resumes same UUID after lost response');
rejected($commands['changedIntent'], 'REQUEST_CONFLICT');
rejected($commands['oldRevision'], 'REVISION_CONFLICT');
$updated = dispatch($commands['update']);
check($updated['status'] === 200 && $updated['data']['post_id'] === $id && $updated['data']['revision'] === 2, 'Update keeps original page ID');
// Real WordPress shortcode processing, not a renderer double. No iframe is fetched.
$GLOBALS['post'] = get_post($id);
$html = apply_filters('the_content', get_post_field('post_content', $id));
check(str_contains($html, '<iframe') && str_contains($html, 'https://sma-automation.com/app/shop-catalog.html?shop=sma-local-fixture'), 'WordPress content filters render bound catalog iframe');
check(!str_contains($html, 'PUBLIC KEY') && !str_contains($html, 'PRIVATE KEY'), 'Rendered content has no key');
$GLOBALS['post'] = get_post((int)$foreign['ID']);
check(do_shortcode('[sma_products]') === '', 'Other pages cannot render managed shortcode');
// Authenticated REST reads work, anonymous REST reads must not expose this draft.
wp_set_current_user(0);
$read = rest_do_request(new WP_REST_Request('GET', '/wp/v2/pages/' . $id));
check($read->get_status() >= 400, 'Anonymous WordPress REST cannot read draft');
$before = $store->load();
$row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d", $id), ARRAY_A);
$filter = function($data) { if ($data['post_type'] === 'page' && $data['post_title'] === 'Produkte') $data['post_content'] = 'Changed by test plugin'; return $data; };
$hook = function($post_id) { add_post_meta($post_id, 'sma_fixture_rollback', 'temporary'); update_option('sma_fixture_rollback', 'temporary'); };
add_filter('wp_insert_post_data', $filter);
add_action('save_post_page', $hook);
rejected($commands['next'], 'CONTENT_FILTERED');
remove_filter('wp_insert_post_data', $filter);
remove_action('save_post_page', $hook);
check($store->load() === $before && $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d", $id), ARRAY_A) === $row, 'InnoDB rollback restores post and bridge state');
check((int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key='sma_fixture_rollback'") === 0 && (int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name='sma_fixture_rollback'") === 0, 'Transactional hook database writes roll back');
$admin = get_user_by('login', 'sma_fixture_admin');
$admin->set_role('subscriber');
rejected($commands['next'], 'ACCESS_REVOKED');
$admin->set_role('administrator');
wp_update_post(['ID' => $id, 'post_content' => 'Manual owner edit']);
rejected($commands['next'], 'PAGE_CHANGED');
check(get_post_field('post_content', $id) === 'Manual owner edit', 'Manual changes are preserved');
wp_delete_post($id, true);
rejected($commands['next'], 'PAGE_CHANGED');
check((int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='page' AND post_title='Produkte'") === 0, 'Deleted draft is not recreated');
check(get_post((int)$foreign['ID'], ARRAY_A) === $foreign, 'Pre-existing page remains unchanged');
// A nontransactional WordPress table must stop even an inspect command.
$wpdb->query("ALTER TABLE {$wpdb->postmeta} ENGINE=MyISAM");
try { rejected($commands['inspect'], 'TRANSACTION_REQUIRED'); }
finally { $wpdb->query("ALTER TABLE {$wpdb->postmeta} ENGINE=InnoDB"); }
deactivate_plugins('sma-bridge/sma-bridge.php');
check($store->load() === [], 'Deactivation removes verification key');
$error = activate_plugin('sma-bridge/sma-bridge.php');
check(!is_wp_error($error) && $store->load() === [], 'Reactivation requires new consent');
check((int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status='publish'") === 0, 'No published fixture content');
reply(['passed' => $passed, 'count' => count($passed)]);
