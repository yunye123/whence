import type { Board, BoardNode } from '../model';
import { exportBoard, exportLocalBoardDirectory } from '../storage';
import { saveExport } from '../file-export';
import { exportBoardMarkdown } from '../draft-export';
import { errorMessage } from './utils';
import { EXPORT_COPY } from '../dialogs/export-format';

/** UI hooks the export dialog's actions report through; state stays with the caller. */
export interface ExportActionHandlers {
  setBusy: (message: string) => void;
  notify: (message: string) => void;
  /** Closes the export dialog after a successful save. */
  close: () => void;
}

export async function exportBoardPackage(board:Board,{setBusy,notify,close}:ExportActionHandlers) {
  setBusy('正在打包画布与素材…');
  try{
    const blob=await exportBoard(board);
    const result=await saveExport({format:'field-json',suggestedName:board.title||'画布',data:new Uint8Array(await blob.arrayBuffer())});
    notify(result.status==='saved'?'画布文件已保存':result.status==='cancelled'?'已取消保存':'画布文件已开始下载');
    if(result.status!=='cancelled')close();
  }catch(error){notify(`导出未完成：${errorMessage(error)}`);}finally{setBusy('');}
}

export async function exportBoardDirectory(board:Board,{setBusy,notify,close}:ExportActionHandlers) {
  setBusy('正在另存完整画布目录…');
  try{
    const result=await exportLocalBoardDirectory(board);
    notify(result.status==='saved'?'完整画布目录已保存':'已取消保存');
    if(result.status==='saved')close();
  }catch(error){notify(`目录未保存：${errorMessage(error)}`);}finally{setBusy('');}
}

export async function exportBoardDraft(board:Board,{setBusy,notify,close}:ExportActionHandlers) {
  setBusy('正在保存文稿与参考资料…');
  try{
    const result=await saveExport({format:'markdown',suggestedName:board.title||'文稿',data:new TextEncoder().encode(exportBoardMarkdown(board))});
    notify(result.status==='saved'?'文稿与来源已保存':result.status==='cancelled'?'已取消保存':'文稿与来源已开始下载');
    if(result.status!=='cancelled')close();
  }catch(error){notify(`文稿未保存：${errorMessage(error)}`);}finally{setBusy('');}
}

/** Same printer and unmodified source arguments as the writing-page entry; loaded on demand. */
export async function exportBoardScript(board: Board, draft: BoardNode, getMediaUrl: (mediaId?: string) => string | undefined, { setBusy, notify, close }: ExportActionHandlers) {
  if (draft.data.kind !== 'draft' || !board.nodes.some(node => node.id === draft.id)) return;
  setBusy(EXPORT_COPY.preparingScript);
  try {
    const { exportScriptPdf } = await import('../inspector/script-view/script-print');
    const result = await exportScriptPdf(draft.data.title, draft.data.body, board.nodes, getMediaUrl);
    if (result !== 'cancelled') { notify(result === 'saved' ? EXPORT_COPY.scriptSaved : EXPORT_COPY.printOpened); close(); }
    return result;
  } catch (error) { notify(`导出未完成：${errorMessage(error)}`); }
  finally { setBusy(''); }
}
