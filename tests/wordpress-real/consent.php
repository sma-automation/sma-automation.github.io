<?php
// Called only after the worker verifies its disposable WordPress installation.
require_once ABSPATH . 'wp-admin/includes/template.php';
$ticket = $input['ticket'];
$admin = get_user_by('login', 'sma_fixture_admin');
wp_set_current_user($admin->ID);
$ticket_reads = 0;
add_filter('pre_http_request', function ($pre, $args, $url) use ($ticket, $input, &$ticket_reads) {
    if ($url !== 'https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-wordpress-ticket'
        || $args['method'] !== 'POST'
        || json_decode($args['body'], true) !== ['ticket' => $ticket, 'website_url' => home_url('/')]) {
        return $pre; // The fixture's isolation plugin blocks every other HTTP request.
    }
    $ticket_reads++;
    return ['headers' => [], 'response' => ['code' => 200, 'message' => 'OK'],
            'body' => wp_json_encode($input['approval']), 'cookies' => []];
}, PHP_INT_MAX, 3);

if ($input['operation'] === 'consent_form') {
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET['ticket'] = $ticket;
    ob_start();
    sma_bridge_settings();
    $html = ob_get_clean();
    $tags = new WP_HTML_Tag_Processor($html);
    if (!$tags->next_tag('FORM') || strtoupper($tags->get_attribute('method') ?? '') !== 'POST'
        || $tags->get_attribute('action') !== admin_url('admin-post.php')) {
        throw new RuntimeException('Expected WordPress consent form');
    }
    $fields = [];
    while ($tags->next_tag('INPUT')) {
        $name = $tags->get_attribute('name');
        if (in_array($name, ['ticket', '_wpnonce', 'action'], true)) {
            $fields[$name] = $tags->get_attribute('value');
        }
    }
    if (($fields['action'] ?? '') !== 'sma_bridge_connect' || ($fields['ticket'] ?? '') !== $ticket
        || !wp_verify_nonce($fields['_wpnonce'] ?? '', 'sma_bridge_connect_'.$ticket)
        || !str_contains($html, esc_html($input['approval']['account_label']))
        || !str_contains($html, esc_html($input['approval']['shop_slug']))
        || $ticket_reads !== 1 || sma_bridge_store()->load() !== []) {
        throw new RuntimeException('Unexpected approval form or state');
    }
    reply($fields);
    return;
}

$_POST = $_REQUEST = $input['fields'];
// The real hook exits after redirect or wp_die. Return only the observed outcome.
add_filter('wp_redirect', function ($url, $status) use (&$ticket_reads) {
    reply(['redirect' => $url, 'status' => $status, 'ticket_reads' => $ticket_reads]);
    return false;
}, 10, 2);
add_filter('wp_die_handler', function () use (&$ticket_reads) {
    return function ($message, $title, $args) use (&$ticket_reads) {
        reply(['rejected' => true, 'ticket_reads' => $ticket_reads]);
        exit;
    };
});
do_action('admin_post_sma_bridge_connect');
throw new RuntimeException('Consent handler returned without a result');
