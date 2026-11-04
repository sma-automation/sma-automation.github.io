<?php
/**
 * Plugin Name: SMA Webseiten-Anschluss (Testkandidat)
 * Description: Einmalige Freigabe und signierte Aufträge für den eigenen SMA-Produktentwurf.
 * Version: 0.1.0
 * Requires at least: 6.8
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) exit;
require_once __DIR__ . '/protocol.php';
require_once __DIR__ . '/store.php';

function sma_bridge_store() { global $wpdb; return new SMA_Bridge_Store($wpdb); }
function sma_bridge_website() { return trailingslashit(home_url('/')); }
function sma_bridge_ticket($ticket) {
    if (!is_string($ticket) || !preg_match('/^[a-f0-9]{64}$/D', $ticket) || !is_ssl()) throw new RuntimeException('INVALID_APPROVAL');
    // Fixed server only, public key only. No WordPress password or private key is sent.
    // This SMA endpoint is not deployed yet; unavailable responses fail closed.
    $response = wp_safe_remote_post('https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-wordpress-ticket', [
        'timeout'=>10, 'redirection'=>0, 'sslverify'=>true, 'limit_response_size'=>8192,
        'headers'=>['Content-Type'=>'application/json','Accept'=>'application/json'],
        'body'=>wp_json_encode(['ticket'=>$ticket,'website_url'=>sma_bridge_website()])
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) throw new RuntimeException('APPROVAL_UNAVAILABLE');
    return SMA_Bridge_Protocol::approval(json_decode(wp_remote_retrieve_body($response), true), sma_bridge_website(), time(), get_current_user_id());
}
register_activation_hook(__FILE__, function($network_wide) {
    if ($network_wide || !extension_loaded('openssl')) wp_die('SMA benötigt eine einzelne Webseite und die PHP-Erweiterung OpenSSL.');
    try {
        $store = sma_bridge_store(); $store->install();
        // Reactivation requires fresh consent; never revive an old verification key.
        $store->transaction(function() use ($store) { $store->save([]); });
    } catch (Throwable $e) { wp_die('Der SMA-Speicher konnte nicht eingerichtet werden.'); }
});
register_deactivation_hook(__FILE__, function() {
    try { $store = sma_bridge_store(); $store->transaction(function() use ($store) { $store->save([]); }); }
    catch (Throwable $e) { /* Routes are removed by deactivation; activation clears again. */ }
});
add_action('rest_api_init', function() {
    register_rest_route('sma-bridge/v1', '/command', [
        'methods'=>'POST',
        'permission_callback'=>function($request) {
            if (!is_ssl()) return new WP_Error('sma_https_required', 'HTTPS erforderlich.', ['status'=>403]);
            try {
                SMA_Bridge_Protocol::verify(sma_bridge_store()->load(), $request->get_body(), $request->get_header('x-sma-signature'), time());
                return true;
            } catch (Throwable $e) { return new WP_Error('sma_not_authorized', 'Auftrag nicht freigegeben.', ['status'=>403]); }
        },
        'callback'=>function($request) {
            try {
                $data = SMA_Bridge_Protocol::command(sma_bridge_store(), $request->get_body(), $request->get_header('x-sma-signature'), sma_bridge_website(), 'time');
                return new WP_REST_Response($data, 200, ['Cache-Control'=>'no-store']);
            } catch (Throwable $e) {
                $safe = ['PAGE_CHANGED','REVISION_CONFLICT','REQUEST_CONFLICT','WEBSITE_CHANGED','ACCESS_REVOKED','NOT_CONNECTED','TRANSACTION_REQUIRED','CONTENT_FILTERED'];
                $code = in_array($e->getMessage(), $safe, true) ? $e->getMessage() : 'UNAVAILABLE';
                return new WP_REST_Response(['ok'=>false,'code'=>$code], 409, ['Cache-Control'=>'no-store']);
            }
        }
    ]);
});
add_shortcode('sma_products', function() {
    try { $s = sma_bridge_store()->load(); return ($s['website_url'] ?? null) === sma_bridge_website() ? SMA_Bridge_Protocol::catalog($s, (int)get_the_ID()) : ''; }
    catch (Throwable $e) { return ''; }
});
add_action('admin_menu', function() { add_options_page('SMA Verbindung', 'SMA Verbindung', 'manage_options', 'sma-bridge', 'sma_bridge_settings'); });
function sma_bridge_settings() {
    if (!current_user_can('manage_options') || !current_user_can('edit_pages')) return;
    echo '<div class="wrap"><h1>SMA Verbindung</h1>';
    try {
        $ticket = isset($_GET['ticket']) ? wp_unslash($_GET['ticket']) : null;
        if ($ticket !== null) {
            $s = sma_bridge_ticket($ticket);
            echo '<p>Verbinde diese Webseite mit dem SMA-Konto <strong>'.esc_html($s['account_label']).'</strong> und dem Shop <strong>'.esc_html($s['shop_slug']).'</strong>.</p>';
            echo '<p>SMA darf einen eigenen Produktbereich als Entwurf anlegen und aktualisieren. Bestehende Inhalte werden nicht ersetzt. Eine Veröffentlichung ist damit nicht freigegeben.</p>';
            echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">';
            wp_nonce_field('sma_bridge_connect_'.$ticket);
            echo '<input type="hidden" name="action" value="sma_bridge_connect"><input type="hidden" name="ticket" value="'.esc_attr($ticket).'">';
            submit_button('Verbindung freigeben'); echo '</form>';
        } else {
            $s = sma_bridge_store()->load();
            if (($s['connected'] ?? false) === true) {
                echo '<p>Freigegeben für '.esc_html($s['account_label']).' · Shop '.esc_html($s['shop_slug']).'.</p>';
                echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">'; wp_nonce_field('sma_bridge_disconnect');
                echo '<input type="hidden" name="action" value="sma_bridge_disconnect">'; submit_button('Verbindung trennen', 'secondary'); echo '</form>';
            } else echo '<p>Starte die Verbindung in SMA unter „Webseite &amp; Domain“.</p>';
        }
    } catch (Throwable $e) { echo '<p>Die Verbindung kann derzeit nicht freigegeben werden. Bitte starte den Vorgang erneut in SMA.</p>'; }
    echo '</div>';
}
add_action('admin_post_sma_bridge_connect', function() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !is_ssl() || !current_user_can('manage_options') || !current_user_can('edit_pages')) wp_die('Keine Freigabe.', '', ['response'=>403]);
    $ticket = isset($_POST['ticket']) ? wp_unslash($_POST['ticket']) : '';
    if (!is_string($ticket) || !preg_match('/^[a-f0-9]{64}$/D', $ticket)) wp_die('Ungültiger Vorgang.');
    check_admin_referer('sma_bridge_connect_'.$ticket);
    try {
        $approved = sma_bridge_ticket($ticket); $store = sma_bridge_store();
        $store->transaction(function() use ($store, $approved) {
            if ($approved['consent_expires_at'] <= time()) throw new RuntimeException('APPROVAL_EXPIRED');
            $old = $store->load();
            if (($old['connected'] ?? false) === true) {
                if ($old['attempt_id'] !== $approved['attempt_id'] || $old['public_key'] !== $approved['public_key'] || $old['shop_slug'] !== $approved['shop_slug'] || $old['website_url'] !== $approved['website_url']) throw new RuntimeException('ALREADY_CONNECTED');
                return; // Repeated consent must not erase the draft revision or page ID.
            }
            // A new account never inherits an old account's page or approval.
            $store->save($approved);
        });
        wp_safe_redirect(admin_url('options-general.php?page=sma-bridge')); exit;
    } catch (Throwable $e) { wp_die('Verbindung nicht gespeichert. Eine bestehende Verbindung muss zuerst getrennt werden.'); }
});
add_action('admin_post_sma_bridge_disconnect', function() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !current_user_can('manage_options')) wp_die('Keine Freigabe.', '', ['response'=>403]);
    check_admin_referer('sma_bridge_disconnect');
    try {
        $store = sma_bridge_store(); $store->transaction(function() use ($store) { $store->save([]); });
        wp_safe_redirect(admin_url('options-general.php?page=sma-bridge')); exit;
    } catch (Throwable $e) { wp_die('Verbindung konnte nicht getrennt werden.'); }
});
