export const MAX_PHOTO_PREVIEW=12*1024*1024;
export function canPreviewPhoto(type:string,size:number){
  return ["image/jpeg","image/png","image/webp","image/avif"].includes(type.toLowerCase())&&Number.isSafeInteger(size)&&size>0&&size<=MAX_PHOTO_PREVIEW;
}
