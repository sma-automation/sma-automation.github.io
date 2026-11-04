<?php
/** WordPress storage adapter. Requires transactional tables; no silent fallback. */
final class SMA_Bridge_Store {
    private $db;
    private $table;
    private $inside = false;
    private $touched = [];
    public function __construct($db) { $this->db = $db; $this->table = $db->prefix . 'sma_bridge_v1'; }
    public function install() {
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$this->table} (\n id tinyint unsigned NOT NULL,\n state longtext NOT NULL,\n PRIMARY KEY  (id)\n) ENGINE=InnoDB " . $this->db->get_charset_collate() . ';');
        if ($this->db->query("INSERT IGNORE INTO {$this->table} (id,state) VALUES (1,'{}')") === false) throw new RuntimeException('STORAGE_UNAVAILABLE');
    }
    public function transaction($fn) {
        if ($this->inside) throw new RuntimeException('STORAGE_BUSY');
        foreach ([$this->table, $this->db->posts, $this->db->postmeta, $this->db->options] as $table) {
            $engine = $this->db->get_var($this->db->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', $table));
            if (strtolower((string)$engine) !== 'innodb') throw new RuntimeException('TRANSACTION_REQUIRED');
        }
        if ($this->db->query('START TRANSACTION') === false) throw new RuntimeException('STORAGE_UNAVAILABLE');
        $this->inside = true; $this->touched = [];
        try {
            $this->load(); // Serialize connection approval, withdrawal and draft creation.
            $result = $fn();
            if ($this->db->query('COMMIT') === false) throw new RuntimeException('STORAGE_UNAVAILABLE');
            return $result;
        } catch (Throwable $e) {
            $this->db->query('ROLLBACK'); throw $e;
        } finally {
            $this->inside = false;
            foreach (array_unique($this->touched) as $id) clean_post_cache($id);
        }
    }
    public function load() {
        $suffix = $this->inside ? ' FOR UPDATE' : '';
        $raw = $this->db->get_var("SELECT state FROM {$this->table} WHERE id=1" . $suffix);
        $s = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($s)) throw new RuntimeException('STORAGE_UNAVAILABLE');
        return $s;
    }
    public function save($state) {
        if (!$this->inside || $this->db->update($this->table, ['state'=>wp_json_encode($state)], ['id'=>1], ['%s'], ['%d']) === false) throw new RuntimeException('STORAGE_UNAVAILABLE');
    }
    public function canEdit($user_id) { return user_can($user_id, 'manage_options') && user_can($user_id, 'edit_pages'); }
    public function readPost($id) {
        if (!$this->inside) throw new RuntimeException('STORAGE_UNAVAILABLE');
        // Read directly under the row lock; object caches may contain an earlier edit.
        $post = $this->db->get_row($this->db->prepare("SELECT * FROM {$this->db->posts} WHERE ID=%d FOR UPDATE", $id), ARRAY_A);
        if ($post) { $post['ID'] = (int)$post['ID']; $post['post_author'] = (int)$post['post_author']; }
        return $post;
    }
    public function writeDraft($id, $fields) {
        if (!$this->inside) throw new RuntimeException('STORAGE_UNAVAILABLE');
        if ($id !== null) { $fields['ID'] = $id; clean_post_cache($id); $this->touched[] = $id; }
        $result = wp_insert_post(wp_slash($fields), true);
        if (is_wp_error($result) || !$result) throw new RuntimeException('STORAGE_UNAVAILABLE');
        $this->touched[] = (int)$result;
        return (int)$result;
    }
}
