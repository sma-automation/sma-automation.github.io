<?php
define('ABSPATH','/');define('ARRAY_A','ARRAY_A');
$hooks=[];$routes=[];$ssl=true;$allowed=true;$nonce=false;$remote=[];$cleaned=[];$passed=0;
class WP_Error { function __construct(...$args) {} }
class WP_REST_Response { function __construct(...$args) {} }
function check($c,$m) { global $passed;if(!$c)throw new RuntimeException($m);$passed++; }
function add_action($name,$fn) { $GLOBALS['hooks'][$name]=$fn; }
function register_activation_hook($f,$fn) { $GLOBALS['hooks']['activate']=$fn; }
function register_deactivation_hook($f,$fn) { $GLOBALS['hooks']['deactivate']=$fn; }
function register_rest_route($ns,$route,$args) { $GLOBALS['routes'][$ns.$route]=$args; }
function add_shortcode($name,$fn) { $GLOBALS['hooks']['shortcode']=$fn; }
function is_ssl() { return $GLOBALS['ssl']; }
function current_user_can(...$args) { return $GLOBALS['allowed']; }
function user_can(...$args) { return $GLOBALS['allowed']; }
function get_current_user_id() { return 12; }
function get_the_ID() { return 100; }
function home_url($path) { return 'https://example.com'.$path; }
function trailingslashit($s) { return rtrim($s,'/').'/'; }
function wp_unslash($v) { return $v; }
function wp_json_encode($v) { return json_encode($v); }
function is_wp_error($v) { return $v instanceof WP_Error; }
function wp_remote_retrieve_response_code($r) { return $r['status']; }
function wp_remote_retrieve_body($r) { return $r['body']; }
function wp_safe_remote_post($url,$args) { $GLOBALS['remote'][]=[$url,$args];return $GLOBALS['reply']; }
function wp_die(...$args) { throw new RuntimeException('WP_DIE'); }
function check_admin_referer($action) { if(!$GLOBALS['nonce'])throw new RuntimeException('NONCE_REJECTED'); }
function clean_post_cache($id) { $GLOBALS['cleaned'][]=$id; }
function esc_html($s) { return htmlspecialchars($s,ENT_QUOTES); }
function esc_attr($s) { return htmlspecialchars($s,ENT_QUOTES); }
function esc_url($s) { return htmlspecialchars($s,ENT_QUOTES); }
function admin_url($s) { return 'https://example.com/wp-admin/'.$s; }
function wp_nonce_field($s) { echo '<input name="_wpnonce" value="synthetic">'; }
function submit_button($s,...$args) { echo '<button>'.esc_html($s).'</button>'; }
final class TestDB {
    public $prefix='wp_',$posts='wp_posts',$postmeta='wp_postmeta',$options='wp_options';
    public $state='{}',$queries=[],$engine='InnoDB',$backup=null,$failCommit=false;
    function prepare($query,...$args) { foreach($args as $a)$query=preg_replace('/%[sd]/',"'".$a."'",$query,1);return $query; }
    function get_var($sql) { $this->queries[]=$sql;return str_contains($sql,'information_schema')?$this->engine:$this->state; }
    function update($table,$data,...$args) { $this->state=$data['state'];return 1; }
    function query($sql) {
        $this->queries[]=$sql;
        if($sql==='START TRANSACTION')$this->backup=$this->state;
        if($sql==='COMMIT'&&$this->failCommit)return false;
        if($sql==='ROLLBACK')$this->state=$this->backup;
        return 1;
    }
}
$wpdb=new TestDB();require '/sma-bridge.php';
$vectors=json_decode(file_get_contents('/vectors.json'),true);$approval=$vectors['approval'];$approval['expires_at']=time()+300;
$reply=['status'=>200,'body'=>json_encode($approval)];$ticket=str_repeat('a',64);
$s=sma_bridge_ticket($ticket);
check($s['public_key']===$approval['public_key']&&!isset($s['privateKey']),'only public key returned');
check($remote[0][0]==='https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-wordpress-ticket','fixed ticket origin');
check($remote[0][1]['redirection']===0&&$remote[0][1]['sslverify']===true&&$remote[0][1]['limit_response_size']===8192,'bounded verified HTTPS without redirects');
check(json_decode($remote[0][1]['body'],true)===['ticket'=>$ticket,'website_url'=>'https://example.com/'],'no WP credentials sent');
$reply['status']=302;
try{sma_bridge_ticket($ticket);throw new RuntimeException('expected redirect rejection');}catch(RuntimeException $e){check($e->getMessage()==='APPROVAL_UNAVAILABLE','redirect rejected');}
$reply['status']=200;$approval['account_label']='<script>bad()</script>';$reply['body']=json_encode($approval);$_GET=['ticket'=>$ticket];
ob_start();sma_bridge_settings();$html=ob_get_clean();
check(!str_contains($html,'<script>')&&str_contains($html,'&lt;script&gt;'),'approval identity escaped');
check(!str_contains($html,'PUBLIC KEY')&&!str_contains($html,'PRIVATE KEY'),'no keys in consent form');
$remote=[];$_SERVER['REQUEST_METHOD']='POST';$_POST=['ticket'=>$ticket];
try{$hooks['admin_post_sma_bridge_connect']();throw new RuntimeException('expected nonce rejection');}catch(RuntimeException $e){check($e->getMessage()==='NONCE_REJECTED','WP consent needs nonce');}
check(count($remote)===0,'bad nonce cannot fetch or store approval');
$allowed=false;
try{$hooks['admin_post_sma_bridge_connect']();throw new RuntimeException('expected permission rejection');}catch(RuntimeException $e){check($e->getMessage()==='WP_DIE','non-admin cannot approve');}
$allowed=true;$hooks['rest_api_init']();$route=$routes['sma-bridge/v1/command'];
check($route['methods']==='POST','command route accepts POST only');
$request=new class {function get_body(){return '{}';}function get_header($s){return '';}};
$ssl=false;check($route['permission_callback']($request) instanceof WP_Error,'HTTP denied');$ssl=true;
check($route['permission_callback']($request) instanceof WP_Error,'unsigned request denied');
check($hooks['shortcode']()==='','disconnected shortcode empty');
$store=sma_bridge_store();$store->transaction(function()use($store){$store->save(['connected'=>true]);});
check($wpdb->state==='{"connected":true}','transaction persists state');
check(in_array('SELECT state FROM wp_sma_bridge_v1 WHERE id=1 FOR UPDATE',$wpdb->queries,true),'transaction takes row lock');
$wpdb->failCommit=true;
try{$store->transaction(function()use($store){$store->save(['connected'=>false]);});throw new RuntimeException('expected commit failure');}catch(RuntimeException $e){check($e->getMessage()==='STORAGE_UNAVAILABLE','commit failure surfaced');}
check($wpdb->state==='{"connected":true}'&&end($wpdb->queries)==='ROLLBACK','failed commit rolls back');$wpdb->failCommit=false;
$wpdb->engine='MyISAM';$wpdb->queries=[];
try{$store->transaction(fn()=>null);throw new RuntimeException('expected engine rejection');}catch(RuntimeException $e){check($e->getMessage()==='TRANSACTION_REQUIRED','nontransactional tables rejected');}
check(!in_array('START TRANSACTION',$wpdb->queries,true),'incompatible storage never starts writes');
$wpdb->engine='InnoDB';$hooks['deactivate']();check($wpdb->state==='[]','deactivation removes public verification key');
echo "WordPress boundary/adapter double cases passed: $passed assertions\n";
