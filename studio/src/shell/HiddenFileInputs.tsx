import type { Ref } from 'react';

export interface HiddenFileInputsProps {
  mediaInput: Ref<HTMLInputElement>;
  boardInput: Ref<HTMLInputElement>;
  subtitleInput: Ref<HTMLInputElement>;
  onMediaFiles: (files: File[]) => void;
  onBoardFile: (file: File) => void;
  onSubtitleFile: (file: File) => void;
}

/** Always mounted: smoke scripts call setInputFiles on these labels ("素材文件", "画布文件"). */
export default function HiddenFileInputs({ mediaInput, boardInput, subtitleInput, onMediaFiles, onBoardFile, onSubtitleFile }: HiddenFileInputsProps) {
  return (
    <>
      <input ref={mediaInput} type="file" accept=".txt,.md,text/plain,text/markdown,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple hidden aria-label="素材文件" onChange={e=>{onMediaFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
      <input ref={boardInput} type="file" accept=".json,.field.json" hidden aria-label="画布文件" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onBoardFile(file);}}/>
      <input ref={subtitleInput} type="file" accept=".srt,.vtt" hidden aria-label="字幕文件" onChange={e=>{const file=e.target.files?.[0];if(file)onSubtitleFile(file);e.target.value='';}}/>
    </>
  );
}
