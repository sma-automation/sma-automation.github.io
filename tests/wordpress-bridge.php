<?php
require '/protocol.php';
$vectors = json_decode(file_get_contents('/vectors.json'), true);
$passed = 0;
function check($condition, $message) { global $passed; if (!$condition) throw new RuntimeException($message); $passed++; }
function rejects($code, $fn) {
    try { $fn(); } catch (RuntimeException $e) { check($e->getMessage() === $code, 'Expected '.$code.', received '.$e->getMessage()); return; }
    throw new RuntimeException('Expected rejection: '.$code);
}
// Transactional memory double: real PHP/OpenSSL and domain behavior, not MySQL or WordPress hooks.
final class TestStore {
    public $state; public $posts = []; public $next = 100; public $writes = 0; public $permission = true; public $failSave = false; public $filter = false;
    function __construct($state) { $this->state = $state; }
    function transaction($fn) {
        $backup = [$this->state,$this->posts,$this->next,$this->writes];
        try { return $fn(); } catch (Throwable $e) { [$this->state,$this->posts,$this->next,$this->writes]=$backup; throw $e; }
    }
    function load() { return $this->state; }
    function save($s) { if ($this->failSave) throw new RuntimeException('STORAGE_UNAVAILABLE'); $this->state=$s; }
    function canEdit($id) { return $this->permission && $id === 12; }
    function readPost($id) { return $this->posts[$id] ?? null; }
    function writeDraft($id,$fields) {
        if ($id === null) $id=$this->next++;
        $this->writes++;$this->posts[$id]=$fields+['ID'=>$id,'post_name'=>'produkte'];
        if ($this->filter) $this->posts[$id]['post_content']='external filter';
        return $id;
    }
}
$now=$vectors['now']; $site='https://example.com/'; $approval=$vectors['approval'];
$state=SMA_Bridge_Protocol::approval($approval,$site,$now,12);
check($state['connected'] && $state['revision']===0 && $state['post_id']===null,'approval state');
$mixed=$approval;$mixed['public_key'].=$vectors['privateKey'];
rejects('INVALID_APPROVAL',fn()=>SMA_Bridge_Protocol::approval($mixed,$site,$now,12));
foreach (['website_url'=>'https://other.example/','shop_slug'=>'bad"slug','expires_at'=>$now,'public_key'=>$vectors['privateKey']] as $key=>$value) {
    $changed=$approval;$changed[$key]=$value;
    rejects('INVALID_APPROVAL',fn()=>SMA_Bridge_Protocol::approval($changed,$site,$now,12));
}
$store=new TestStore($state);
$run=function($name, $at=null) use ($store,$vectors,$site,$now) { $v=$vectors['commands'][$name];return SMA_Bridge_Protocol::command($store,$v['body'],$v['headers']['X-SMA-Signature'],$site,$at??$now); };
check($run('inspect')['can_publish']===false,'no publish capability');
check($store->writes===0,'inspect must not write');
rejects('SIGNATURE_REJECTED',fn()=>$run('wrongKey'));
rejects('INVALID_REQUEST',fn()=>$run('wrongAttempt'));
rejects('INVALID_REQUEST',fn()=>$run('publish'));
rejects('INVALID_REQUEST',fn()=>$run('inspect',$now+91));
rejects('SIGNATURE_REJECTED',fn()=>$run('tampered'));
check($store->writes===0,'denied commands cannot write');
$first=$run('create');check($first['state']==='draft'&&$first['revision']===1&&$first['post_id']===100,'create one draft');
check(count($store->posts)===1 && $store->posts[100]['post_status']==='draft','draft only');
check($run('create')===$first && $store->writes===1,'lost reply must not create again');
check($run('replayLater',$now+120)===$first && $store->writes===1,'same intent may be re-signed after timeout');
rejects('REQUEST_CONFLICT',fn()=>$run('sameIdChangedIntent'));
rejects('REVISION_CONFLICT',fn()=>$run('oldRevision'));
$second=$run('update');check($second['revision']===2&&$second['post_id']===100&&count($store->posts)===1,'update same draft');
$saved=$store->posts[100];
foreach (['post_title'=>'Owner title','post_content'=>'Owner content','post_status'=>'publish','post_name'=>'owner-slug','post_author'=>13] as $key=>$value) {
    $store->posts[100]=$saved;$store->posts[100][$key]=$value;
    rejects('PAGE_CHANGED',fn()=>$run('updateAgain'));
    check($store->posts[100][$key]===$value,'external edit preserved');
}
unset($store->posts[100]);rejects('PAGE_CHANGED',fn()=>$run('updateAgain'));check(count($store->posts)===0,'missing draft not recreated');
$store->posts[100]=$saved;$store->permission=false;rejects('ACCESS_REVOKED',fn()=>$run('updateAgain'));$store->permission=true;
$v=$vectors['commands']['inspect'];rejects('WEBSITE_CHANGED',fn()=>SMA_Bridge_Protocol::command($store,$v['body'],$v['headers']['X-SMA-Signature'],'https://other.example/',$now));
rejects('INVALID_REQUEST',fn()=>SMA_Bridge_Protocol::command($store,$v['body'],$v['headers']['X-SMA-Signature'],$site,fn()=>$now+91));
$store->failSave=true;$before=$store->posts;
rejects('STORAGE_UNAVAILABLE',fn()=>$run('updateAgain'));check($store->posts===$before&&$store->state['revision']===2,'transaction rolls back post and revision');$store->failSave=false;
$store->filter=true;rejects('CONTENT_FILTERED',fn()=>$run('updateAgain'));check($store->posts===$before,'filter failure rollback');$store->filter=false;
$html=SMA_Bridge_Protocol::catalog($store->state,100);
check(str_contains($html,'https://sma-automation.com/app/shop-catalog.html?shop=sma-testkunde'),'fixed catalog target');
check(!str_contains($html,'PUBLIC KEY')&&!str_contains($html,'PRIVATE KEY'),'no key in rendered page');
check(SMA_Bridge_Protocol::catalog($store->state,101)==='','unmanaged page cannot render this catalog');
$store->state=[];rejects('NOT_CONNECTED',fn()=>$run('updateAgain'));check(SMA_Bridge_Protocol::catalog([],100)==='','disconnection stops rendering');
echo "WordPress bridge PHP/OpenSSL cases passed: $passed assertions\n";
