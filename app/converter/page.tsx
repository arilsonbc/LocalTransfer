import type {Metadata} from "next";
import ImageConverter from "./image-converter";
export const metadata:Metadata={title:"Conversor de imagens — LocalTransfer",description:"Converta fotos para JPG, PNG ou WebP e reduza as dimensões no navegador, sem enviar suas imagens a um servidor."};
export default function ConverterPage(){return <ImageConverter/>;}
