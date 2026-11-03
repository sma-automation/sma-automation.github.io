'use strict';

// The handoff is read by the existing server-only subworkflow, never from a browser.
// Text fields are prepared here; this module cannot grant upload approval.
function publisherText(handoff, selection) {
  const same = (a,b) => a && b && Object.keys(b).every(k => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;
  const denied = code => ({ok:false,stage:'publisher_preparation',can_upload:false,can_publish:false,code});
  if (handoff?.ok !== true) {
    const known = ['ACCESS_INACTIVE','FILE_UNAVAILABLE','FILE_CHANGED','ASSIGNMENT_UNAVAILABLE','ASSIGNMENT_CHANGED','HANDOFF_CHANGED','FILE_REFRESH_REQUIRED','MEDIA_CHECK_UNAVAILABLE','SAVED_TEXT_INVALID'];
    return denied(known.includes(handoff?.code) ? handoff.code : 'HANDOFF_UNAVAILABLE');
  }
  if (handoff.version !== 1 || handoff.stage !== 'handoff_preview' || handoff.can_upload !== false || handoff.can_publish !== false ||
      !same(handoff.binding,selection) || !Array.isArray(handoff.blockers) || !handoff.blockers.includes('PUBLICATION_APPROVAL_REQUIRED') ||
      !handoff.blockers.includes('PUBLICATION_RESERVATION_REQUIRED') || !handoff.checks || handoff.checks.saved_selection !== 'matched') {
    return denied('HANDOFF_CHANGED');
  }
  const d=handoff.draft, p=selection.platform, kind=selection.media_kind;
  if (!d || d.platform!==p || typeof d.title!=='string' || !d.title.trim() || typeof d.caption!=='string' || !d.caption.trim()) return denied('SAVED_TEXT_INVALID');
  let fields;
  if (p==='youtube' && kind==='video') fields={snippet:{title:d.title,description:d.caption}};
  else if (p==='instagram' && ['image','video'].includes(kind)) fields={caption:d.caption};
  else if (p==='facebook' && kind==='image') fields={message:d.caption};
  else if (p==='facebook' && kind==='video') fields={description:d.caption};
  else if (p==='tiktok' && kind==='video') fields={post_info:{title:d.caption}};
  else return denied('PUBLISHER_ROUTE_UNSUPPORTED');
  return {...handoff,stage:'publisher_preparation',can_upload:false,can_publish:false,adapter_fields:fields};
}

module.exports={publisherText};
