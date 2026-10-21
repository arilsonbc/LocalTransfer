const codePattern=/^[A-HJ-NP-Z2-9]{8}$/;
export function readInvite(value:string):string|null {
  let code=value.trim();
  if(/^https?:\/\//i.test(code)) {
    try {code=new URLSearchParams(new URL(code).hash.slice(1)).get("sala")||"";}catch{return null;}
  }
  code=code.toUpperCase().replace(/[\s-]/g,"");
  return codePattern.test(code)?code:null;
}
export function makeInvite(page:string,code:string) {
  const normalized=readInvite(code);
  if(!normalized)throw new Error("Código de convite inválido.");
  const current=new URL(page);
  const invite=new URL("/",current.origin);
  if(current.searchParams.get("relay")==="1")invite.searchParams.set("relay","1");
  invite.hash=new URLSearchParams({sala:normalized}).toString();
  return invite.toString();
}
