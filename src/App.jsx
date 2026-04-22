import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabase";

const CAT = {
  Groente:     { bg:"#e8f5e9", accent:"#1b5e20", light:"#c8e6c9", emoji:"🥦" },
  Fruit:       { bg:"#fff8e1", accent:"#e65100", light:"#ffe0b2", emoji:"🍎" },
  Kruiden:     { bg:"#f3e5f5", accent:"#4a148c", light:"#e1bee7", emoji:"🌿" },
  Aardappelen: { bg:"#fbe9e7", accent:"#bf360c", light:"#ffccbc", emoji:"🥔" },
  Overig:      { bg:"#e3f2fd", accent:"#0d47a1", light:"#bbdefb", emoji:"🛒" },
};
const LANDEN = {
  "Nederland":"🇳🇱","Spanje":"🇪🇸","Italië":"🇮🇹","Duitsland":"🇩🇪",
  "Frankrijk":"🇫🇷","België":"🇧🇪","Marokko":"🇲🇦","Turkije":"🇹🇷",
  "Polen":"🇵🇱","Portugal":"🇵🇹","Griekenland":"🇬🇷","Peru":"🇵🇪",
  "Zuid-Afrika":"🇿🇦","Chili":"🇨🇱","Egypte":"🇪🇬","Israël":"🇮🇱",
};
const EENHEDEN = [
  {groep:"── Stuks ──"},"per stuk","per bosje","per pot","per bos","per zak","per bak","per bundel",
  {groep:"── Gewicht ──"},"per kg","per 100g","per 200g","per 250g","per 500g",
  {groep:"── Overig ──"},"per liter","per doos",
];

const opslagNaarMarge = (o) => (o / (100 + o)) * 100;
const margeNaarOpslag = (m) => (m / (100 - m)) * 100;

function winkelPrijs(raw) {
  if (!raw || raw <= 0) return 0;
  let e;
  if (raw < 1)    e = [0.29,0.49,0.59,0.69,0.79,0.89,0.95,0.99];
  else if(raw<5)  e = [0.49,0.69,0.79,0.95,0.98,0.99];
  else if(raw<10) e = [0.49,0.95,0.98,0.99];
  else            e = [0.95,0.99];
  const v = Math.floor(raw);
  const kand = [...e.map(x=>v+x), ...(v>0?e.map(x=>(v-1)+x):[]), ...e.map(x=>(v+1)+x)].filter(k=>k>0);
  const bov = kand.filter(k=>k>=raw).sort((a,b)=>a-b);
  const ond = kand.filter(k=>k<raw).sort((a,b)=>b-a);
  if (!bov.length) return ond[0]??raw;
  if (!ond.length) return bov[0];
  return (bov[0]-raw)<=(raw-ond[0]) ? bov[0] : ond[0];
}

const rawInclBtw  = (i,o,b) => i*(1+o/100)*(1+b/100);
const inclBtw     = (i,o,b) => winkelPrijs(rawInclBtw(i,o,b));
const exclBtw     = (i,o)   => Math.round(i*(1+o/100)*100)/100;
const margePctVan = (i,o,b) => {
  const vk = inclBtw(i,o,b);
  const ko  = i*(1+b/100);
  return vk > 0 ? ((vk - ko) / vk) * 100 : 0;
};
const fmt  = (p) => typeof p==="number" ? p.toFixed(2).replace(".",",") : "–";
const vlag = (l) => LANDEN[l] || "🌍";
const nu   = () => new Date().toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"});

function normaliseerNaam(naam) {
  const adj = {"witte":"wit","rode":"rood","groene":"groen","gele":"geel","zwarte":"zwart","paarse":"paars","bruine":"bruin","zoete":"zoet","kleine":"klein","grote":"groot","verse":"vers","ronde":"rond"};
  let w = naam.toLowerCase().replace(/[^a-zàáâãäåèéêëìíîïòóôõöùúûü\s]/g,"").trim().split(/\s+/);
  w = w.map(x => adj[x] ?? x);
  return [...new Set(w)].sort().join(" ");
}
function vindMatch(bonNaam, producten) {
  const normBon = normaliseerNaam(bonNaam);
  let m = producten.find(p => normaliseerNaam(p.naam) === normBon);
  if (m) return { product: m, score: 1.0 };
  const wBon = new Set(normBon.split(" "));
  let best = null, bestScore = 0;
  for (const p of producten) {
    const wP = new Set(normaliseerNaam(p.naam).split(" "));
    const overlap = [...wBon].filter(w => wP.has(w)).length;
    const score = overlap / Math.max(wBon.size, wP.size);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (bestScore >= 0.6) return { product: best, score: bestScore };
  return null;
}export default function App({ user }) {
  const [tab,         setTab]         = useState("producten");
  const [prod,        setProd]        = useState([]);
  const [dbLaden,     setDbLaden]     = useState(true);
  const [opslaan,     setOpslaan]     = useState(false);
  const [gOpslag,     setGOpslag]     = useState(30);
  const [gMarge,      setGMarge]      = useState(+opslagNaarMarge(30).toFixed(2));
  const [gBtw,        setGBtw]        = useState(9);
  const [minMarge,    setMinMarge]    = useState(20);
  const [maxMarge,    setMaxMarge]    = useState(50);
  const [winkel,      setWinkel]      = useState("Mijn Groentewinkel");
  const [printSet,    setPrintSet]    = useState(new Set());
  const [nieuw,       setNieuw]       = useState({cat:"Groente",naam:"",eenheid:"per kg",inkoop:"",opslag:30,btw:9,land:"Nederland",actie:""});
  const [scanning,    setScanning]    = useState(false);
  const [scanStatus,  setScanStatus]  = useState(null);
  const [reviewItems, setReviewItems] = useState(null);
  const fileRef = useRef();

  useEffect(() => { laadProducten(); laadInstellingen(); }, []);

  const laadProducten = async () => {
    setDbLaden(true);
    const { data, error } = await supabase.from("producten").select("*").order("cat").order("naam");
    if (!error && data) setProd(data);
    setDbLaden(false);
  };

  const laadInstellingen = async () => {
    const { data } = await supabase.from("instellingen").select("*").single();
    if (data) {
      setWinkel(data.winkelnaam || "Mijn Groentewinkel");
      setGOpslag(data.opslag || 30);
      setGMarge(+opslagNaarMarge(data.opslag || 30).toFixed(2));
      setGBtw(data.btw || 9);
      setMinMarge(data.min_marge || 20);
      setMaxMarge(data.max_marge || 50);
    }
  };

  const slaInstellingenOp = async () => {
    await supabase.from("instellingen").upsert({ id:1, winkelnaam:winkel, opslag:gOpslag, btw:gBtw, min_marge:minMarge, max_marge:maxMarge });
  };

  const setGO = (v) => { const o=parseFloat(v)||0; setGOpslag(o); setGMarge(+opslagNaarMarge(o).toFixed(2)); };
  const setGM = (v) => { const m=Math.min(parseFloat(v)||0,99); setGMarge(m); setGOpslag(+margeNaarOpslag(m).toFixed(2)); };

  const upd = async (id,k,v) => {
    setProd(prev=>prev.map(p=>{
      if(p.id!==id) return p;
      const u={...p,[k]:v};
      if(k==="inkoop"||k==="opslag") u.gewijzigd=nu();
      return u;
    }));
    const patch = {[k]:v};
    if(k==="inkoop"||k==="opslag") patch.gewijzigd=nu();
    await supabase.from("producten").update(patch).eq("id",id);
  };

  const updOpslag = (id,o) => upd(id,"opslag",+parseFloat(o).toFixed(2));
  const updMarge  = (id,m) => updOpslag(id, margeNaarOpslag(Math.min(parseFloat(m)||0,99)));

  const pasGlobaalToe = async () => {
    setProd(p=>p.map(pr=>({...pr,opslag:gOpslag,btw:gBtw,gewijzigd:nu()})));
    await supabase.from("producten").update({opslag:gOpslag,btw:gBtw,gewijzigd:nu()});
    await slaInstellingenOp();
  };

  const verwijderProduct = async (id) => {
    await supabase.from("producten").delete().eq("id",id);
    setProd(p=>p.filter(pr=>pr.id!==id));
  };

  const voegToe = async () => {
    if(!nieuw.naam||!nieuw.inkoop) return;
    const nieuwProd={...nieuw,inkoop:parseFloat(nieuw.inkoop),actief:true,gewijzigd:nu()};
    const {data} = await supabase.from("producten").insert(nieuwProd).select().single();
    if(data) setProd(p=>[...p,data]);
    setNieuw({cat:"Groente",naam:"",eenheid:"per kg",inkoop:"",opslag:gOpslag,btw:gBtw,land:"Nederland",actie:""});
  };

  const scanBon = async (file) => {
    setScanning(true); setScanStatus("Bon wordt gelezen…"); setReviewItems(null);
    try {
      const b64 = await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
      const ci = file.type==="application/pdf"
        ? {type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}
        : {type:"image",source:{type:"base64",media_type:file.type,data:b64}};
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1500,
          system:`Je bent een helper voor een groentewinkel. Lees de leveranciersbon.
Geef ALLEEN een JSON array terug, geen markdown:
[{"naam":"Tomaten","eenheid":"per kg","inkoop":1.20,"cat":"Groente","land":"Nederland"}]
Categorieën: Groente, Fruit, Kruiden, Aardappelen, Overig. Land in het Nederlands of "Onbekend".`,
          messages:[{role:"user",content:[ci,{type:"text",text:"Geef alle producten met inkoopprijzen als JSON array."}]}]
        })
      });
      const data = await res.json();
      const txt = data.content?.find(b=>b.type==="text")?.text||"[]";
      const bonRows = JSON.parse(txt.replace(/```json|```/g,"").trim());
      const items = bonRows.map((r,i)=>{
        const match=vindMatch(r.naam,prod);
        const bestaandProd=match?.product??null;
        const nieuweInkoop=parseFloat(r.inkoop)||0;
        const opslag=bestaandProd?.opslag??gOpslag;
        const btw=bestaandProd?.btw??gBtw;
        const marge=margePctVan(nieuweInkoop,opslag,btw);
        const margeWaarschuwing=marge<minMarge?"laag":marge>maxMarge?"hoog":null;
        return {tempId:i,bonNaam:r.naam,naam:bestaandProd?.naam??r.naam,cat:bestaandProd?.cat??r.cat??"Groente",
          eenheid:bestaandProd?.eenheid??r.eenheid??"per kg",land:r.land||bestaandProd?.land||"Onbekend",
          inkoop:nieuweInkoop,oudeInkoop:bestaandProd?.inkoop??null,opslag,btw,
          bestaandId:bestaandProd?.id??null,isNieuw:!bestaandProd,margeWaarschuwing,
          marge:+marge.toFixed(1),sel:true,goedgekeurd:!margeWaarschuwing};
      });
      setScanStatus(null); setReviewItems(items);
    } catch { setScanStatus("❌ Er ging iets mis. Probeer opnieuw."); }
    setScanning(false);
  };

  const updReview = (i,patch) => setReviewItems(prev=>prev.map((r,ri)=>{
    if(ri!==i) return r;
    const u={...r,...patch};
    if("inkoop" in patch||"opslag" in patch){
      const m=margePctVan(u.inkoop,u.opslag,u.btw);
      u.marge=+m.toFixed(1);
      u.margeWaarschuwing=m<minMarge?"laag":m>maxMarge?"hoog":null;
      if(!u.margeWaarschuwing) u.goedgekeurd=true;
    }
    return u;
  }));

  const keurGoed = (i) => setReviewItems(prev=>prev.map((r,ri)=>ri===i?{...r,goedgekeurd:true}:r));

  const bevestigImport = async () => {
    setOpslaan(true);
    const teImporteren=reviewItems.filter(r=>r.sel&&r.goedgekeurd);
    let lijst=[...prod];
    for(const r of teImporteren){
      if(r.bestaandId){
        await supabase.from("producten").update({inkoop:r.inkoop,opslag:r.opslag,land:r.land,gewijzigd:nu()}).eq("id",r.bestaandId);
        lijst=lijst.map(p=>p.id===r.bestaandId?{...p,inkoop:r.inkoop,opslag:r.opslag,land:r.land,gewijzigd:nu()}:p);
      } else {
        const {data}=await supabase.from("producten").insert({cat:r.cat,naam:r.naam,eenheid:r.eenheid,inkoop:r.inkoop,opslag:r.opslag,btw:r.btw,land:r.land,actief:true,gewijzigd:nu(),actie:""}).select().single();
        if(data) lijst.push(data);
      }
    }
    setProd(lijst); setReviewItems(null); setOpslaan(false); setTab("producten");
  };

  const togglePrint=(id)=>setPrintSet(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setPrintSet(new Set(prod.filter(p=>p.actief).map(p=>p.id)));
  const uitloggen=()=>supabase.auth.signOut();
  const printKaartjes = () => {
    const lijst=prod.filter(p=>printSet.has(p.id)&&p.actief);
    if(!lijst.length) return;
    const ac=c=>(CAT[c]||CAT.Overig).accent;
    const li=c=>(CAT[c]||CAT.Overig).light;
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.grid{display:grid;grid-template-columns:105mm 105mm;width:210mm;margin:0 auto}
.kaartje{width:105mm;height:148mm;display:flex;flex-direction:column;page-break-inside:avoid;overflow:hidden;border:1px solid #ddd;position:relative}
.zijbalk{position:absolute;left:0;top:0;bottom:0;width:8mm}
.inhoud{margin-left:8mm;flex:1;display:flex;flex-direction:column;padding:7mm 7mm 5mm 6mm}
.cat-label{font-size:7pt;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:3mm}
.naam{font-family:'Fraunces',serif;font-size:20pt;font-weight:900;line-height:1.05;color:#111;flex:1;display:flex;align-items:flex-start}
.prijs-blok{margin:4mm 0 2mm}
.prijs-incl{display:flex;align-items:flex-start;gap:1mm;line-height:1}
.p-sym{font-family:'Fraunces',serif;font-size:16pt;font-weight:700;padding-top:4pt;color:#111}
.p-heel{font-family:'Fraunces',serif;font-size:54pt;font-weight:900;color:#111;line-height:1}
.p-cent{font-family:'Fraunces',serif;font-size:22pt;font-weight:700;padding-top:8pt;color:#111}
.eenheid{font-size:10pt;font-weight:500;color:#555;margin-bottom:2mm}
.actie-tag{display:inline-block;padding:2.5mm 4mm;border-radius:3px;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3mm}
.footer{border-top:1px solid #e8e8e8;padding:3mm 7mm 3mm 6mm;display:flex;justify-content:space-between;align-items:center;margin-left:8mm}
@media print{@page{size:A4 portrait;margin:5mm}}
</style></head><body><div class="grid">
${lijst.map(p=>{
  const kl=ac(p.cat),lt=li(p.cat);
  const vk=inclBtw(p.inkoop,p.opslag,p.btw);
  const [heel,cent]=vk.toFixed(2).split(".");
  return `<div class="kaartje">
<div class="zijbalk" style="background:${kl}"></div>
<div class="inhoud">
  <div class="cat-label" style="color:${kl}">${(CAT[p.cat]||CAT.Overig).emoji} ${p.cat}</div>
  <div class="naam">${p.naam}</div>
  <div class="prijs-blok"><div class="prijs-incl">
    <span class="p-sym">€</span><span class="p-heel">${heel}</span><span class="p-cent">,${cent}</span>
  </div></div>
  <div class="eenheid">${p.eenheid}</div>
  ${p.actie?`<div class="actie-tag" style="background:${lt};color:${kl};border:1.5px solid ${kl}">${p.actie}</div>`:""}
</div>
<div class="footer">
  <div style="font-size:8pt;color:#777">${vlag(p.land)} ${p.land||""}</div>
  <div style="font-size:6.5pt;color:#bbb">${winkel}</div>
</div></div>`;
}).join("")}
</div></body></html>`;
    const w=window.open("","_blank");w.document.write(html);w.document.close();setTimeout(()=>w.print(),700);
  };

  const cats=[...new Set(prod.map(p=>p.cat))];
  const landen=Object.keys(LANDEN);
  const S={border:"1px solid #e0e0e0",borderRadius:6,padding:"5px 8px",fontSize:13,background:"white"};
  const Btn=(c,extra={})=>({background:c,color:"white",border:"none",borderRadius:7,padding:"7px 15px",fontSize:13,fontWeight:700,cursor:"pointer",...extra});
  const waarschuwingen=prod.filter(p=>{const m=margePctVan(p.inkoop,p.opslag,p.btw);return m<minMarge||m>maxMarge;});

  return (
    <div style={{minHeight:"100vh",background:"#f0f4f0",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a4a1a,#2d6a2d)",padding:"14px 20px",color:"white",boxShadow:"0 2px 8px rgba(0,0,0,.2)"}}>
        <div style={{maxWidth:1150,margin:"0 auto",display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:9,opacity:.5,letterSpacing:3,textTransform:"uppercase"}}>Prijsbeheer systeem</div>
            <div style={{fontSize:18,fontWeight:700,marginBottom:10}}>{winkel}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[["producten","📋 Producten"],["scanner","📸 Bon scannen"],["kaartjes","🏷️ Schapkaartjes"]].map(([t,l])=>(
                <button key={t} onClick={()=>setTab(t)} style={{padding:"6px 16px",borderRadius:20,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:tab===t?"white":"rgba(255,255,255,.18)",color:tab===t?"#1a4a1a":"white"}}>{l}</button>
              ))}
              {waarschuwingen.length>0&&<button onClick={()=>setTab("producten")} style={{marginLeft:8,padding:"6px 14px",borderRadius:20,border:"2px solid #ffcc02",background:"#ffcc02",color:"#333",fontSize:13,fontWeight:700,cursor:"pointer"}}>⚠️ {waarschuwingen.length} melding{waarschuwingen.length>1?"en":""}</button>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,paddingTop:4}}>
            <div style={{fontSize:12,opacity:.7}}>{user?.email}</div>
            <button onClick={uitloggen} style={{background:"rgba(255,255,255,.15)",color:"white",border:"1px solid rgba(255,255,255,.3)",borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>Uitloggen</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1150,margin:"0 auto",padding:"14px 12px"}}>
        {dbLaden&&<div style={{textAlign:"center",padding:40,color:"#888",fontSize:15}}>⏳ Producten laden…</div>}
        {!dbLaden&&<>
          <div style={{background:"white",borderRadius:12,padding:"14px 18px",marginBottom:12,boxShadow:"0 1px 6px rgba(0,0,0,.07)"}}>
            <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"flex-end"}}>
              <div><div style={{fontSize:11,color:"#888",marginBottom:3,fontWeight:600}}>Winkelnaam</div><input value={winkel} onChange={e=>setWinkel(e.target.value)} onBlur={slaInstellingenOp} style={{...S,width:175}}/></div>
              <div><div style={{fontSize:11,color:"#888",marginBottom:3,fontWeight:600}}>Opslag %</div><input type="number" step="0.1" value={gOpslag} onChange={e=>setGO(e.target.value)} onBlur={slaInstellingenOp} style={{...S,width:70}}/></div>
              <div style={{paddingBottom:6,color:"#bbb",fontSize:18}}>⇄</div>
              <div><div style={{fontSize:11,color:"#888",marginBottom:3,fontWeight:600}}>Marge %</div><input type="number" step="0.1" value={gMarge} onChange={e=>setGM(e.target.value)} onBlur={slaInstellingenOp} style={{...S,width:78,color:"#1a4a1a",fontWeight:700}}/></div>
              <div><div style={{fontSize:11,color:"#888",marginBottom:3,fontWeight:600}}>BTW %</div><select value={gBtw} onChange={e=>{setGBtw(Number(e.target.value));slaInstellingenOp();}} style={S}><option value={0}>0%</option><option value={9}>9%</option><option value={21}>21%</option></select></div>
              <div style={{width:1,background:"#eee",alignSelf:"stretch",margin:"0 4px"}}/>
              <div><div style={{fontSize:11,color:"#e65100",marginBottom:3,fontWeight:600}}>⚠️ Min. marge %</div><input type="number" step="1" value={minMarge} onChange={e=>setMinMarge(Number(e.target.value))} onBlur={slaInstellingenOp} style={{...S,width:68,borderColor:"#ffcc80"}}/></div>
              <div><div style={{fontSize:11,color:"#1b5e20",marginBottom:3,fontWeight:600}}>✅ Max. marge %</div><input type="number" step="1" value={maxMarge} onChange={e=>setMaxMarge(Number(e.target.value))} onBlur={slaInstellingenOp} style={{...S,width:68,borderColor:"#a5d6a7"}}/></div>
              <button onClick={pasGlobaalToe} style={{...Btn("#1b5e20"),alignSelf:"flex-end"}}>Pas alle aan</button>
            </div>
          </div>

          {tab==="producten"&&<div>
            {waarschuwingen.length>0&&<div style={{background:"#fff8e1",border:"1.5px solid #ffcc02",borderRadius:10,padding:"12px 18px",marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:"#7c4a00",marginBottom:8}}>⚠️ {waarschuwingen.length} product{waarschuwingen.length>1?"en vallen":"valt"} buiten marge ({minMarge}%–{maxMarge}%)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{waarschuwingen.map(p=>{const m=margePctVan(p.inkoop,p.opslag,p.btw);const isLaag=m<minMarge;return(<div key={p.id} style={{background:"white",border:`1.5px solid ${isLaag?"#ef9a9a":"#a5d6a7"}`,borderRadius:8,padding:"7px 12px",fontSize:12}}><strong>{p.naam}</strong><span style={{color:isLaag?"#c62828":"#2e7d32",marginLeft:8,fontWeight:700}}>{isLaag?"↓ te laag":"↑ te hoog"}: {m.toFixed(1)}%</span></div>);})}</div>
            </div>}
            {cats.map(cat=>{const k=CAT[cat]||CAT.Overig;const rijen=prod.filter(p=>p.cat===cat);return(<div key={cat} style={{background:"white",borderRadius:12,marginBottom:12,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.07)"}}>
              <div style={{background:k.accent,color:"white",padding:"9px 18px",fontSize:12,fontWeight:700,letterSpacing:1.5}}>{k.emoji} {cat.toUpperCase()} ({rijen.length})</div>
              <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:1000}}>
                <thead><tr style={{background:k.bg,fontSize:11,color:"#666"}}>
                  {["Product","Eenheid","Herkomst","Inkoop €","Opslag %","Marge %","Excl.","BTW","Incl. BTW","Actie","Gewijzigd","Actief",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:["Inkoop €","Opslag %","Marge %","Excl.","Incl. BTW"].includes(h)?"right":"left",fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>{rijen.map((p,i)=>{
                  const vkE=exclBtw(p.inkoop,p.opslag),vkI=inclBtw(p.inkoop,p.opslag,p.btw),m=margePctVan(p.inkoop,p.opslag,p.btw);
                  const mc=m>=minMarge&&m<=maxMarge?"#1b5e20":m<minMarge?"#c62828":"#e65100";
                  const alarm=m<minMarge||m>maxMarge;
                  return(<tr key={p.id} style={{background:alarm?"#fff8f8":i%2===0?"white":"#fafafa",borderTop:"1px solid #f0f0f0"}}>
                    <td style={{padding:"6px 10px",fontSize:13,fontWeight:600}}>{alarm&&"⚠️"} {p.naam}</td>
                    <td style={{padding:"6px 10px"}}><select value={p.eenheid} onChange={e=>upd(p.id,"eenheid",e.target.value)} style={{...S,padding:"3px 6px",fontSize:12,width:105}}>{EENHEDEN.map((o,oi)=>typeof o==="string"?<option key={oi} value={o}>{o}</option>:<option key={oi} disabled>{o.groep}</option>)}</select></td>
                    <td style={{padding:"6px 10px"}}><div style={{display:"flex",alignItems:"center",gap:4}}><span>{vlag(p.land)}</span><select value={p.land||""} onChange={e=>upd(p.id,"land",e.target.value)} style={{...S,padding:"3px 6px",fontSize:12,width:108}}><option value="">–</option>{landen.map(l=><option key={l} value={l}>{l}</option>)}</select></div></td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:3}}><span style={{fontSize:11,color:"#bbb"}}>€</span><input type="number" step="0.01" value={p.inkoop} onChange={e=>upd(p.id,"inkoop",parseFloat(e.target.value)||0)} style={{...S,width:65,textAlign:"right"}}/></div></td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}><input type="number" step="0.1" value={p.opslag} onChange={e=>updOpslag(p.id,e.target.value)} style={{...S,width:55,textAlign:"right"}}/><span style={{fontSize:11,color:"#bbb"}}>%</span></div></td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}><input type="number" step="0.1" value={+m.toFixed(1)} onChange={e=>updMarge(p.id,e.target.value)} style={{...S,width:55,textAlign:"right",color:mc,fontWeight:700,background:alarm?"#fff0f0":"#f8fff8"}}/><span style={{fontSize:11,color:mc,fontWeight:700}}>%</span></div></td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontSize:13,color:"#555"}}>€ {fmt(vkE)}</td>
                    <td style={{padding:"6px 10px"}}><select value={p.btw} onChange={e=>upd(p.id,"btw",Number(e.target.value))} style={{...S,padding:"3px 6px",fontSize:12}}><option value={0}>0%</option><option value={9}>9%</option><option value={21}>21%</option></select></td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontWeight:700,color:k.accent,fontSize:14}}>€ {fmt(vkI)}</td>
                    <td style={{padding:"6px 10px"}}><input value={p.actie||""} placeholder="bijv. 2+1" onChange={e=>upd(p.id,"actie",e.target.value)} style={{...S,width:130,fontSize:12}}/></td>
                    <td style={{padding:"6px 10px",fontSize:11,color:"#ccc",whiteSpace:"nowrap"}}>{p.gewijzigd}</td>
                    <td style={{padding:"6px 10px",textAlign:"center"}}><input type="checkbox" checked={p.actief} onChange={e=>upd(p.id,"actief",e.target.checked)}/></td>
                    <td style={{padding:"6px 10px",textAlign:"center"}}><button onClick={()=>verwijderProduct(p.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#e53935",fontSize:15}}>✕</button></td>
                  </tr>);
                })}</tbody>
              </table></div>
            </div>);})}
            <div style={{background:"white",borderRadius:12,padding:16,boxShadow:"0 1px 6px rgba(0,0,0,.07)"}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1b5e20",marginBottom:12}}>➕ Product toevoegen</div>
              <div style={{display:"flex",gap:9,flexWrap:"wrap",alignItems:"flex-end"}}>
                {[["Cat",<select value={nieuw.cat} onChange={e=>setNieuw(n=>({...n,cat:e.target.value}))} style={S}>{Object.keys(CAT).map(c=><option key={c}>{c}</option>)}</select>],
                  ["Naam",<input placeholder="Naam" value={nieuw.naam} onChange={e=>setNieuw(n=>({...n,naam:e.target.value}))} style={{...S,width:140}}/>],
                  ["Eenheid",<select value={nieuw.eenheid} onChange={e=>setNieuw(n=>({...n,eenheid:e.target.value}))} style={{...S,width:110}}>{EENHEDEN.map((o,oi)=>typeof o==="string"?<option key={oi} value={o}>{o}</option>:<option key={oi} disabled>{o.groep}</option>)}</select>],
                  ["Land",<select value={nieuw.land} onChange={e=>setNieuw(n=>({...n,land:e.target.value}))} style={{...S,width:110}}>{landen.map(l=><option key={l}>{l}</option>)}</select>],
                  ["Inkoop €",<input type="number" placeholder="0.00" step="0.01" value={nieuw.inkoop} onChange={e=>setNieuw(n=>({...n,inkoop:e.target.value}))} style={{...S,width:80}}/>],
                  ["BTW",<select value={nieuw.btw} onChange={e=>setNieuw(n=>({...n,btw:Number(e.target.value)}))} style={S}><option value={0}>0%</option><option value={9}>9%</option><option value={21}>21%</option></select>],
                  ["Actie",<input placeholder="bijv. 3+1" value={nieuw.actie} onChange={e=>setNieuw(n=>({...n,actie:e.target.value}))} style={{...S,width:130}}/>],
                ].map(([lbl,el])=>(<div key={lbl}><div style={{fontSize:11,color:"#888",marginBottom:3,fontWeight:600}}>{lbl}</div>{el}</div>))}
                <button onClick={voegToe} style={{...Btn("#1b5e20"),alignSelf:"flex-end"}}>Toevoegen</button>
              </div>
            </div>
          </div>}

          {tab==="scanner"&&<div>
            {!reviewItems&&<div style={{background:"white",borderRadius:12,padding:36,textAlign:"center",boxShadow:"0 1px 6px rgba(0,0,0,.07)"}}>
              <div style={{fontSize:48,marginBottom:10}}>📸</div>
              <div style={{fontSize:18,fontWeight:700,color:"#1a4a1a",marginBottom:6}}>Bon of factuur uploaden</div>
              <div style={{fontSize:13,color:"#888",marginBottom:24}}>AI leest producten, prijzen en herkomst automatisch uit.</div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={e=>e.target.files[0]&&scanBon(e.target.files[0])}/>
              <button onClick={()=>fileRef.current.click()} disabled={scanning} style={{...Btn(scanning?"#bbb":"#1b5e20"),padding:"12px 32px",fontSize:15,borderRadius:10}}>{scanning?"⏳ Bezig...":"📁 Bestand kiezen"}</button>
              {scanStatus&&<div style={{marginTop:16,fontSize:14,fontWeight:600,color:"#c62828"}}>{scanStatus}</div>}
            </div>}
            {reviewItems&&<div>
              <div style={{background:"white",borderRadius:12,padding:"14px 20px",marginBottom:14,boxShadow:"0 1px 6px rgba(0,0,0,.07)",display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
                <div><div style={{fontSize:16,fontWeight:700,color:"#1a4a1a"}}>📋 Controleer producten</div>
                  <div style={{fontSize:12,color:"#888",marginTop:2}}>{reviewItems.filter(r=>!r.isNieuw).length} bijgewerkt · {reviewItems.filter(r=>r.isNieuw).length} nieuw · <span style={{color:"#c62828",fontWeight:600}}>{reviewItems.filter(r=>r.margeWaarschuwing).length} marge-meldingen</span></div>
                </div>
                <div style={{marginLeft:"auto",display:"flex",gap:10}}>
                  <button onClick={()=>setReviewItems(null)} style={{background:"none",color:"#888",border:"1px solid #ddd",borderRadius:7,padding:"7px 14px",fontSize:13,cursor:"pointer"}}>Annuleren</button>
                  <button onClick={bevestigImport} disabled={opslaan||reviewItems.some(r=>r.sel&&!r.goedgekeurd)} style={{...Btn(opslaan||reviewItems.some(r=>r.sel&&!r.goedgekeurd)?"#bbb":"#1b5e20"),padding:"8px 22px"}}>{opslaan?"⏳ Opslaan…":`✅ Importeer (${reviewItems.filter(r=>r.sel&&r.goedgekeurd).length})`}</button>
                </div>
              </div>
              {reviewItems.map((r,i)=>{const vkI=inclBtw(r.inkoop,r.opslag,r.btw);const alarm=r.margeWaarschuwing;const isLaag=alarm==="laag";return(<div key={i} style={{background:"white",borderRadius:12,marginBottom:10,border:`2px solid ${!r.goedgekeurd&&alarm?"#ffcc02":r.goedgekeurd?"#c8e6c9":"#e0e0e0"}`,boxShadow:"0 1px 4px rgba(0,0,0,.06)",overflow:"hidden"}}>
                <div style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",background:!r.goedgekeurd&&alarm?"#fff8e1":r.isNieuw?"#e3f2fd":"#f9f9f9",borderBottom:"1px solid #f0f0f0"}}>
                  <input type="checkbox" checked={r.sel} onChange={e=>updReview(i,{sel:e.target.checked})} style={{width:16,height:16}}/>
                  <div style={{flex:1,minWidth:180}}><div style={{fontSize:14,fontWeight:700}}>{r.naam}{r.isNieuw&&<span style={{marginLeft:8,fontSize:10,background:"#1565c0",color:"white",borderRadius:4,padding:"2px 6px"}}>NIEUW</span>}</div>
                    {!r.isNieuw&&r.bonNaam!==r.naam&&<div style={{fontSize:11,color:"#888"}}>Op bon: "{r.bonNaam}" → {r.naam}</div>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}>{r.oudeInkoop!=null&&<span style={{color:"#aaa",textDecoration:"line-through"}}>€{fmt(r.oudeInkoop)}</span>}<span style={{color:r.oudeInkoop&&r.inkoop>r.oudeInkoop?"#c62828":r.oudeInkoop&&r.inkoop<r.oudeInkoop?"#1b5e20":"#333",fontWeight:700}}>{r.oudeInkoop?"→ ":""}€{fmt(r.inkoop)}</span></div>
                  <div style={{fontWeight:700,color:"#1b5e20",fontSize:15}}>€ {fmt(vkI)}</div>
                  <div style={{background:alarm?(isLaag?"#ffebee":"#fff8e1"):"#e8f5e9",color:alarm?(isLaag?"#c62828":"#e65100"):"#1b5e20",borderRadius:6,padding:"4px 10px",fontSize:12,fontWeight:700}}>{alarm?(isLaag?"⚠️ te laag":"⚠️ te hoog"):"✅"} {r.marge}%</div>
                  {!r.goedgekeurd?<button onClick={()=>keurGoed(i)} style={{...Btn("#e65100"),fontSize:12,padding:"5px 12px"}}>Toch goedkeuren</button>:<span style={{fontSize:12,color:"#1b5e20",fontWeight:700}}>✅ Goedgekeurd</span>}
                </div>
                {alarm&&!r.goedgekeurd&&<div style={{padding:"12px 16px",background:"#fffde7",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                  <div style={{fontSize:12,color:"#7c4a00",fontWeight:600}}>{isLaag?`Marge ${r.marge}% onder minimum ${minMarge}%`:`Marge ${r.marge}% boven maximum ${maxMarge}%`}. Pas aan:</div>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div><div style={{fontSize:10,color:"#888",marginBottom:2}}>Inkoop €</div><input type="number" step="0.01" value={r.inkoop} onChange={e=>updReview(i,{inkoop:parseFloat(e.target.value)||0})} style={{...S,width:72,borderColor:"#ffcc02"}}/></div>
                    <span style={{color:"#bbb"}}>of</span>
                    <div><div style={{fontSize:10,color:"#888",marginBottom:2}}>Opslag %</div><input type="number" step="0.1" value={r.opslag} onChange={e=>updReview(i,{opslag:parseFloat(e.target.value)||0})} style={{...S,width:64,borderColor:"#ffcc02"}}/></div>
                    <div style={{fontSize:12,color:"#888"}}>→ marge: <strong>{margePctVan(r.inkoop,r.opslag,r.btw).toFixed(1)}%</strong> · prijs: <strong>€{fmt(inclBtw(r.inkoop,r.opslag,r.btw))}</strong></div>
                  </div>
                </div>}
              </div>);})}
            </div>}
          </div>}

          {tab==="kaartjes"&&<div>
            <div style={{background:"white",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",gap:9,alignItems:"center",flexWrap:"wrap",boxShadow:"0 1px 6px rgba(0,0,0,.07)"}}>
              <button onClick={selectAll} style={{background:"#e8f5e9",color:"#1b5e20",border:"1px solid #a5d6a7",borderRadius:7,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Alles selecteren</button>
              <button onClick={()=>setPrintSet(new Set())} style={{background:"#fafafa",color:"#555",border:"1px solid #ddd",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer"}}>Niets</button>
              <span style={{fontSize:11,color:"#bbb"}}>A6 · 4 per A4 · incl. BTW</span>
              <span style={{fontSize:13,color:"#777",marginLeft:"auto",fontWeight:600}}>{printSet.size} geselecteerd</span>
              <button onClick={printKaartjes} disabled={printSet.size===0} style={{...Btn(printSet.size?"#1b5e20":"#bbb"),padding:"8px 20px",fontSize:14,borderRadius:8}}>🖨️ Afdrukken ({printSet.size})</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:10}}>
              {prod.filter(p=>p.actief).map(p=>{
                const k=CAT[p.cat]||CAT.Overig,sel=printSet.has(p.id),vkI=inclBtw(p.inkoop,p.opslag,p.btw);
                const alarm=margePctVan(p.inkoop,p.opslag,p.btw)<minMarge||margePctVan(p.inkoop,p.opslag,p.btw)>maxMarge;
                return(<div key={p.id} onClick={()=>togglePrint(p.id)} style={{borderRadius:12,cursor:"pointer",overflow:"hidden",transition:"all .15s",border:`2px solid ${alarm?"#ffcc02":sel?k.accent:"#e0e0e0"}`,boxShadow:sel?`0 4px 14px ${k.accent}30`:"0 1px 4px rgba(0,0,0,.06)",display:"flex"}}>
                  <div style={{width:6,background:alarm?"#ffcc02":k.accent,flexShrink:0}}/>
                  <div style={{flex:1,background:sel?k.bg:"white",padding:"11px 13px 11px 11px"}}>
                    <div style={{fontSize:9,color:k.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:1.3,marginBottom:4}}>{k.emoji} {p.cat}</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#111",lineHeight:1.2,marginBottom:6}}>{p.naam}</div>
                    <div style={{fontSize:26,fontWeight:800,color:k.accent,lineHeight:1}}>€ {fmt(vkI)}</div>
                    <div style={{fontSize:10,color:"#777",marginTop:3}}>{p.eenheid}</div>
                    {p.actie&&<div style={{marginTop:7,background:k.light,color:k.accent,borderRadius:4,padding:"3px 7px",fontSize:10,fontWeight:700,display:"inline-block"}}>{p.actie}</div>}
                    <div style={{marginTop:8,paddingTop:7,borderTop:"1px solid #eee",display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontSize:11}}>{vlag(p.land)}</span>
                      <span style={{fontSize:9,color:"#bbb"}}>{p.land||"–"}</span>
                    </div>
                  </div>
                </div>);
              })}
            </div>
          </div>}
        </>}
      </div>
    </div>
  );
}

