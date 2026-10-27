export type ImageFormat="jpeg"|"png"|"webp";
export type ImageOptions={format:ImageFormat;quality:number;maxEdge:number};
export const IMAGE_LIMITS={files:20,fileBytes:20*1024*1024,batchBytes:100*1024*1024,pixels:40_000_000,outputEdge:4096};
const formats={jpeg:{mime:"image/jpeg",extension:"jpg"},png:{mime:"image/png",extension:"png"},webp:{mime:"image/webp",extension:"webp"}};
export function validateImage(file:{name:string;size:number}){
  if(!/\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name))throw new Error("Escolha uma foto JPG, PNG, WebP, AVIF, HEIC ou HEIF. O suporte depende do navegador.");
  if(!file.size||file.size>IMAGE_LIMITS.fileBytes)throw new Error("Escolha uma imagem de até 20 MB que não esteja vazia.");
}
export function imageDimensions(width:number,height:number,maxEdge:number){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>IMAGE_LIMITS.pixels)throw new Error("A imagem excede o limite de 40 megapixels ou tem dimensões inválidas.");
  if(!Number.isFinite(maxEdge)||maxEdge<0)throw new Error("Tamanho de saída inválido.");
  const edge=Math.min(maxEdge||IMAGE_LIMITS.outputEdge,IMAGE_LIMITS.outputEdge),scale=Math.min(1,edge/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function imageOutputName(name:string,format:ImageFormat){
  return `${name.replace(/\.[^.]*$/,"").replace(/[\\/\u0000-\u001f<>:"|?*]/g,"_").replace(/^\.+/,"_").slice(0,180)||"imagem"}-convertida.${formats[format].extension}`;
}
export async function convertImage(file:File,options:ImageOptions){
  validateImage(file);
  if(!Object.hasOwn(formats,options.format)||!Number.isFinite(options.quality)||options.quality<0.1||options.quality>1)throw new Error("Configuração de conversão inválida.");
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});}
  catch{throw new Error("O navegador não conseguiu abrir esta foto. Para HEIC/HEIF, tente Safari ou exporte a foto como JPG no celular.");}
  const canvas=document.createElement("canvas");
  try{
    const dimensions=imageDimensions(bitmap.width,bitmap.height,options.maxEdge);canvas.width=dimensions.width;canvas.height=dimensions.height;
    const context=canvas.getContext("2d");if(!context)throw new Error("Conversão indisponível neste navegador.");
    if(options.format==="jpeg"){context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);}
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Não foi possível gerar a imagem. Tente reduzir as dimensões.")),formats[options.format].mime,options.quality));
    if(blob.type!==formats[options.format].mime)throw new Error("Este navegador não consegue gerar o formato escolhido. Tente JPG ou PNG.");
    if(blob.size>IMAGE_LIMITS.batchBytes)throw new Error("A imagem gerada ficou grande demais. Reduza as dimensões.");
    return {blob,...dimensions,name:imageOutputName(file.name,options.format)};
  }finally{bitmap.close();canvas.width=1;canvas.height=1;}
}
