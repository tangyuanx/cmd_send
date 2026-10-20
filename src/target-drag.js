// A drag starts with movement, never with a long-press timer. Native picking
// tracks the release globally after the pointer leaves the application.
export function bindTargetDrag(button,{canStart,onDrag,onClick,onCancel},distance=4){
  let gesture=null,suppressClick=false;
  function release(){
    const previous=gesture;gesture=null;
    if(previous&&button.hasPointerCapture?.(previous.id))button.releasePointerCapture(previous.id);
    return previous;
  }
  function cancel(){
    const previous=release();if(!previous)return false;
    suppressClick=true;if(previous.started)onCancel();return true;
  }
  button.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||!canStart())return;
    suppressClick=false;gesture={id:event.pointerId,x:event.clientX,y:event.clientY,started:false};
    // Capture keeps move/up events coming when a quick drag leaves the button.
    try{button.setPointerCapture(event.pointerId);}catch{ /* A cancelled native pointer cannot be captured. */ }
  });
  button.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    if(!(event.buttons&1)){release();return;}
    if(gesture.started||Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<distance)return;
    if(!canStart()){release();return;}
    gesture.started=true;suppressClick=true;event.preventDefault();onDrag();
  });
  button.ownerDocument.addEventListener('pointerup',event=>{
    if(gesture?.id===event.pointerId)release();
  },true);
  button.addEventListener('pointercancel',event=>{if(gesture?.id===event.pointerId)cancel();});
  button.addEventListener('lostpointercapture',event=>{
    // Losing DOM capture must not abort an active native picker outside the
    // window: its system mouse-button monitor still handles the eventual drop.
    if(gesture?.id===event.pointerId)gesture=null;
  });
  button.addEventListener('dragstart',event=>event.preventDefault());
  button.addEventListener('click',event=>{
    if(suppressClick&&event.detail!==0){event.preventDefault();return;}
    if(canStart())onClick();
  });
  return {cancel};
}
