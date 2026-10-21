import type {RoomStore} from "./room-store";

export type TurnUsage={status:"disabled"|"unavailable"|"ok"|"warning"|"limit";egressBytes:number;ingressBytes:number;budgetBytes:number;checkedAt:number;periodStart:string};
export const STUN_ONLY:RTCIceServer[]=[{urls:"stun:stun.cloudflare.com:3478"}];
export function monthlyBudget() {
  const raw=process.env.TURN_MONTHLY_BUDGET_GB;
  const gb=raw===undefined?900:Number(raw);
  if(!Number.isFinite(gb)||gb<=0||gb>100000)throw new Error("Invalid TURN budget");
  return gb*1_000_000_000;
}
export async function readTurnUsage(store:RoomStore,now=Date.now()):Promise<TurnUsage> {
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;
  // UTC calendar month, independent of the provider's invoice cycle.
  const start=new Date(Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),1)).toISOString();
  const base={egressBytes:0,ingressBytes:0,budgetBytes:monthlyBudget(),checkedAt:now,periodStart:start};
  if(!account&&!token)return {...base,status:"disabled"};
  if(!account||!token)return {...base,status:"unavailable"};
  const cacheKey=`turn-usage:${account}:${start}`;
  try {
    const cached=await store.cached?.(cacheKey);
    if(cached){const value=JSON.parse(cached) as TurnUsage;
      if(value.periodStart===start&&value.checkedAt<=now&&now-value.checkedAt<300000&&Number.isFinite(value.egressBytes)&&value.egressBytes>=0&&Number.isFinite(value.ingressBytes)&&value.ingressBytes>=0)
        return classify({...base,egressBytes:value.egressBytes,ingressBytes:value.ingressBytes,checkedAt:value.checkedAt});
    }
    const query=`query($account:String!,$from:Time!,$to:Time!){viewer{accounts(filter:{accountTag:$account}){callsTurnUsageAdaptiveGroups(limit:1,filter:{datetime_geq:$from,datetime_leq:$to}){sum{egressBytes ingressBytes}}}}}`;
    const response=await fetch("https://api.cloudflare.com/client/v4/graphql",{method:"POST",cache:"no-store",signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({query,variables:{account,from:start,to:new Date(now).toISOString()}})});
    const data=await response.json();
    const accounts=data?.data?.viewer?.accounts;
    if(!response.ok||data.errors?.length||!Array.isArray(accounts)||accounts.length!==1)throw new Error("Analytics unavailable");
    const groups=accounts[0]?.callsTurnUsageAdaptiveGroups;
    if(!Array.isArray(groups)||groups.length>1)throw new Error("Invalid analytics");
    const totals=groups.length?groups[0]?.sum:{egressBytes:0,ingressBytes:0};
    if(!totals||![totals.egressBytes,totals.ingressBytes].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0))throw new Error("Invalid totals");
    const result=classify({...base,...totals});
    await store.cache?.(cacheKey,JSON.stringify(result),300);
    return result;
  } catch {return {...base,status:"unavailable"};}
}
function classify(value:Omit<TurnUsage,"status">):TurnUsage {
  return {...value,status:value.egressBytes>=value.budgetBytes?"limit":value.egressBytes>=value.budgetBytes*.8?"warning":"ok"};
}
export function turnNotice(usage:TurnUsage) {
  if(usage.status==="warning")return "O serviço de retransmissão está próximo do limite mensal. Prefira conectar os aparelhos na mesma rede Wi-Fi.";
  if(usage.status==="limit")return "O limite mensal de retransmissão foi atingido. Ainda é possível tentar uma conexão direta, por exemplo na mesma rede Wi-Fi.";
  if(usage.status==="unavailable")return "Não foi possível verificar o limite de retransmissão. Por segurança, esta tentativa usará apenas conexão direta. Tente novamente mais tarde ou use a mesma rede Wi-Fi.";
  return "";
}
