<?php
/** Narrow protocol: public verification key, fixed SMA draft, no WP passwords. */
final class SMA_Bridge_Protocol {
    const SIGNING_PREFIX = "SMA-BRIDGE-V1\nPOST\n/sma-bridge/v1/command\n";
    const CONTENT = "<!-- wp:shortcode -->\n[sma_products]\n<!-- /wp:shortcode -->";

    private static function fail($code) { throw new RuntimeException($code); }
    private static function uuid($value) {
        return is_string($value) && preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $value);
    }
    private static function keys($value, $keys) {
        if (!is_array($value)) return false;
        $actual = array_keys($value); sort($actual); sort($keys);
        return $actual === $keys;
    }
    public static function approval($data, $website, $now, $admin_id) {
        if (!self::keys($data, ['ok','attempt_id','website_url','shop_slug','account_label','public_key','expires_at']) || $data['ok'] !== true
            || !self::uuid($data['attempt_id']) || $data['website_url'] !== $website || !str_starts_with($website, 'https://')
            || !is_string($data['shop_slug']) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $data['shop_slug']) || strlen($data['shop_slug']) > 63
            || !is_string($data['account_label']) || strlen($data['account_label']) < 1 || strlen($data['account_label']) > 200
            || !is_int($data['expires_at']) || $data['expires_at'] <= $now || $data['expires_at'] > $now + 600
            || !is_int($admin_id) || $admin_id < 1
            || !is_string($data['public_key']) || strlen($data['public_key']) > 4096
            || !str_starts_with($data['public_key'], '-----BEGIN PUBLIC KEY-----')) self::fail('INVALID_APPROVAL');
        $key = openssl_pkey_get_public($data['public_key']);
        $details = $key ? openssl_pkey_get_details($key) : false;
        if (!$details || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 2048 || $details['bits'] > 4096
            || trim($details['key']) !== trim($data['public_key'])) self::fail('INVALID_APPROVAL');
        return ['connected'=>true, 'attempt_id'=>$data['attempt_id'], 'website_url'=>$website,
            'shop_slug'=>$data['shop_slug'], 'account_label'=>$data['account_label'], 'public_key'=>$data['public_key'],
            'approved_by'=>$admin_id, 'consent_expires_at'=>$data['expires_at'], 'revision'=>0, 'post_id'=>null, 'snapshot'=>null, 'last_request'=>null];
    }
    public static function verify($state, $body, $signature, $now) {
        if (($state['connected'] ?? false) !== true) self::fail('NOT_CONNECTED');
        if (!is_string($body) || strlen($body) > 2048 || !is_string($signature) || strlen($signature) > 700) self::fail('INVALID_REQUEST');
        $p = json_decode($body, true);
        $keys = ['action','attempt_id','issued_at','request_id'];
        if (($p['action'] ?? '') === 'sync_draft') $keys[] = 'expected_revision';
        if (!self::keys($p, $keys) || !in_array($p['action'], ['inspect','sync_draft'], true)
            || !self::uuid($p['request_id']) || $p['attempt_id'] !== $state['attempt_id']
            || !is_int($p['issued_at']) || abs($now - $p['issued_at']) > 90
            || ($p['action'] === 'sync_draft' && (!is_int($p['expected_revision']) || $p['expected_revision'] < 0 || $p['expected_revision'] >= 2147483647))) self::fail('INVALID_REQUEST');
        $decoded = base64_decode($signature, true);
        if (!$decoded || base64_encode($decoded) !== $signature
            || openssl_verify(self::SIGNING_PREFIX . $body, $decoded, $state['public_key'], OPENSSL_ALGO_SHA256) !== 1) self::fail('SIGNATURE_REJECTED');
        return $p;
    }
    private static function snapshot($post) {
        $fields = [];
        foreach (['ID','post_type','post_status','post_title','post_content','post_name','post_author','comment_status','ping_status'] as $field) $fields[$field] = $post[$field] ?? null;
        return hash('sha256', json_encode($fields));
    }
    public static function command($store, $body, $signature, $website, $clock) {
        return $store->transaction(function() use ($store, $body, $signature, $website, $clock) {
            $s = $store->load();
            // Recheck under the database lock: a permission callback alone can race revocation.
            $now = is_callable($clock) ? $clock() : $clock;
            $p = self::verify($s, $body, $signature, $now);
            if ($s['website_url'] !== $website) self::fail('WEBSITE_CHANGED');
            if (!$store->canEdit($s['approved_by'])) self::fail('ACCESS_REVOKED');
            $result = ['ok'=>true,'attempt_id'=>$s['attempt_id'],'website_url'=>$website,'shop_slug'=>$s['shop_slug'],
                'revision'=>$s['revision'],'post_id'=>$s['post_id'],'can_read'=>true,'can_sync_draft'=>true,'can_publish'=>false];
            if ($p['action'] === 'inspect') return $result;
            // Never overwrite an edited, deleted, replaced or already published page.
            if ($s['post_id'] !== null) {
                $post = $store->readPost($s['post_id']);
                if (!$post || $post['post_status'] !== 'draft' || $post['post_type'] !== 'page'
                    || self::snapshot($post) !== $s['snapshot']) self::fail('PAGE_CHANGED');
            }
            $intent = hash('sha256', json_encode([$p['action'], $p['attempt_id'], $p['expected_revision']]));
            if (($s['last_request']['id'] ?? null) === $p['request_id']) {
                if ($s['last_request']['intent'] !== $intent) self::fail('REQUEST_CONFLICT');
                return $result + ['state'=>'draft'];
            }
            if ($p['expected_revision'] !== $s['revision']) self::fail('REVISION_CONFLICT');
            $post_id = $store->writeDraft($s['post_id'], ['post_type'=>'page','post_status'=>'draft','post_title'=>'Produkte',
                'post_content'=>self::CONTENT,'post_author'=>$s['approved_by'],'comment_status'=>'closed','ping_status'=>'closed']);
            $post = $store->readPost($post_id);
            if (!$post || $post['post_type'] !== 'page' || $post['post_status'] !== 'draft' || $post['post_content'] !== self::CONTENT
                || $post['post_title'] !== 'Produkte') self::fail('CONTENT_FILTERED');
            $s['post_id'] = $post_id; $s['snapshot'] = self::snapshot($post); $s['revision']++;
            $s['last_request'] = ['id'=>$p['request_id'],'intent'=>$intent];
            $store->save($s);
            $result['post_id'] = $post_id; $result['revision'] = $s['revision'];
            return $result + ['state'=>'draft'];
        });
    }
    public static function catalog($state, $post_id) {
        if (($state['connected'] ?? false) !== true || $post_id !== ($state['post_id'] ?? null)
            || !is_string($state['shop_slug'] ?? null) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $state['shop_slug']) || strlen($state['shop_slug']) > 63) return '';
        $slug = $state['shop_slug']; // Restricted ASCII slug, fixed origin, no caller HTML.
        return '<iframe src="https://sma-automation.com/app/shop-catalog.html?shop='.$slug.'" title="Produkte aus unserem SMA-Shop" width="100%" height="640" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;height:640px;border:1px solid #e4e7ed;border-radius:12px;background:#fff"></iframe>'
            .'<p><a href="https://sma-automation.com/app/shop.html?shop='.$slug.'" target="_blank" rel="noopener noreferrer">Shop separat öffnen</a></p>';
    }
}
