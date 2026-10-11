import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Modal } from './types';
import { editableTarget } from './utils';

// Where focus goes when a dialog or a whole-window layer opens and closes (CORE-32: moved out of App.tsx unchanged).

/** A modal dialog takes the focus (into its content once a lazy dialog arrives, G3), traps Tab, and gives it back. */
export function useDialogFocus({modal,modalHost}:{modal:Modal;modalHost:RefObject<HTMLDivElement|null>}) {
  // The last focused control outside dialogs: where a modal returns focus when its own field took focus on mount (autoFocus).
  const lastOutsideFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const track=(event:FocusEvent)=>{const target=event.target;if(target instanceof HTMLElement&&!target.closest('.modal-backdrop,dialog'))lastOutsideFocus.current=target;};
    document.addEventListener('focusin',track,true);return()=>document.removeEventListener('focusin',track,true);
  },[]);
  useEffect(()=>{
    if(!modal||modal==='search')return;
    // The dialog of this modal shell, not whichever [role=dialog] happens to come first in the document (EN-m3).
    const dialog=modalHost.current?.querySelector<HTMLElement>('[role="dialog"]')??null;
    const focused=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
    const previous=focused&&!dialog?.contains(focused)?focused:lastOutsideFocus.current;
    const focusables=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')??[])
      .filter(element=>element.tabIndex>=0&&!element.matches(':disabled')&&element.getClientRects().length>0&&!element.closest('[inert]'));
    const focusFirst=()=>{const stops=focusables();(stops.find(element=>element.matches('input,textarea'))??stops[0])?.focus();};
    focusFirst();
    // A lazy dialog (CORE-31) shows only its close button for the first frames: move focus into the content once it
    // arrives, unless the person has already moved it.
    const closeButton=dialog?.querySelector<HTMLElement>('.modal-close')??null;
    let arrival:MutationObserver|undefined;
    if(dialog&&focusables().every(item=>item===closeButton)){
      arrival=new MutationObserver(()=>{
        if(!focusables().some(item=>item!==closeButton))return;
        arrival?.disconnect();
        if(document.activeElement===closeButton||document.activeElement===document.body)focusFirst();
      });
      arrival.observe(dialog,{childList:true,subtree:true});
    }
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab'||e.defaultPrevented)return;const items=focusables();const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    window.addEventListener('keydown',trap);
    return()=>{
      arrival?.disconnect();
      window.removeEventListener('keydown',trap);
      // Return focus a frame later, so the Enter that submitted the dialog cannot also activate its trigger (SB-M1).
      requestAnimationFrame(()=>{const active=document.activeElement;if(active&&active!==document.body&&active.isConnected)return;if(previous?.isConnected)previous.focus();});
    };
  },[modal]);
}

/**
 * FV-M9: the watch workbench and focus writing cover the whole window. What they cover (sidebar, top bar, canvas)
 * leaves the Tab order and the accessibility tree, focus moves into the layer when it opens from elsewhere (the
 * sidebar list, a card), and returns to where it came from when the layer closes.
 */
export function useCoverLayer() {
  const [workspaceBody,setWorkspaceBody]=useState<HTMLElement|null>(null);
  const [coverLayer,setCoverLayer]=useState(false);
  const coverLayerRef=useRef(false);
  const layerOpener=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!workspaceBody)return;
    let watched:Element|null=null;
    const classes=new MutationObserver(()=>update());
    const update=()=>{
      const aside=workspaceBody.querySelector(':scope > aside.inspector');
      if(aside!==watched){classes.disconnect();watched=aside;if(aside)classes.observe(aside,{attributes:true,attributeFilter:['class']});}
      const covering=!!aside?.matches('.inspector--video, .inspector--writing-expanded');
      if(covering===coverLayerRef.current)return;
      if(covering){const active=document.activeElement;layerOpener.current=active instanceof HTMLElement&&active!==document.body&&!aside?.contains(active)?active:null;}
      coverLayerRef.current=covering;setCoverLayer(covering);
    };
    const children=new MutationObserver(update);
    children.observe(workspaceBody,{childList:true});
    update();
    return()=>{children.disconnect();classes.disconnect();};
  },[workspaceBody]);
  useEffect(()=>{
    let frame=0,frames=0;
    const tick=()=>{
      const active=document.activeElement;
      if(coverLayer){
        // The lazy panel may still be its placeholder: wait for the real header (about two seconds at most).
        const aside=workspaceBody?.querySelector<HTMLElement>(':scope > aside.inspector');
        if(aside&&active instanceof HTMLElement&&aside.contains(active))return;
        const close=aside?.querySelector<HTMLElement>('.inspector-head-close');
        if(close){close.focus({preventScroll:true});return;}
        if(++frames<120)frame=requestAnimationFrame(tick);
        return;
      }
      // Back to what opened the layer (a sidebar entry, a card, a toolbar button); it wins over closeInspector's
      // fallback to the card, but not over a field the person is in.
      const opener=layerOpener.current;layerOpener.current=null;
      if(opener?.isConnected&&!opener.closest('[inert]')&&(!active||active===document.body||(active instanceof HTMLElement&&!!active.closest('.canvas-shell')&&!editableTarget(active))))opener.focus({preventScroll:true});
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[coverLayer,workspaceBody]);
  return {setWorkspaceBody,coverLayer};
}

