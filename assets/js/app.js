(function(){
"use strict";

/* ================= constantes ================= */
const KEY = "genmeet:state";
const SUPABASE_URL = "https://spttmvjfmdfotuncdlht.supabase.co";
const SUPABASE_KEY = "sb_publishable_6eoKmTrmcgEsH4lkEtRE6w_CX099YVy";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
});

let supabaseStatusTimer=null;
function garantirBotaoRetry(){
  const status=document.getElementById("supabase-status"); if(!status || document.getElementById("supabase-retry")) return;
  const btn=document.createElement("button"); btn.id="supabase-retry"; btn.textContent="Tentar novamente";
  btn.style.cssText="display:none;margin-left:8px;padding:4px 8px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-size:11px";
  btn.onclick=async()=>{ btn.disabled=true; const ok=await carregarDadosSupabase(); if(ok){applyConfig();renderAll();} btn.disabled=false; };
  status.appendChild(btn);
}
function setSupabaseStatus(kind,text){
  const el=document.getElementById("supabase-status");
  if(!el) return;
  el.className=kind||"";
  const t=el.querySelector(".status-text");
  if(t) t.textContent=text||"Supabase";
  garantirBotaoRetry();
  const retry=document.getElementById("supabase-retry"); if(retry) retry.style.display=(kind==="err"?"inline-block":"none");
}
async function verificarSupabase(){
  setSupabaseStatus("","Conectando...");
  try{
    const {error}=await sb.from("configuracoes").select("id").eq("id","global").maybeSingle();
    if(error) throw error;
    setSupabaseStatus("ok","Supabase conectado");
    return true;
  }catch(e){
    console.warn("Supabase: conexão indisponível",e);
    setSupabaseStatus("err","Supabase offline");
    return false;
  }
}
function statusSalvo(){
  clearTimeout(supabaseStatusTimer);
  setSupabaseStatus("save","Salvo");
  supabaseStatusTimer=setTimeout(verificarSupabase,1800);
}
const MEDIA = id => "genmeet:media:" + id;
const DEFAULT_CFG = {
  nome:"GenMeet",
  logo:"",
  cores:{bg:"#1327C6", navy:"#0A1240", blue:"#3350F0", green:"#8FE01B", teal:"#1596A8"},
  lembretes:[60,30],
  notificacoes:true,
  servidor:"",
  regras:{participantesObrig:true, bloquearPassado:true, confirmarExclusao:true},
  rotulos:{"especialista":"Especialista","juiz-robo":"Juiz de Robô","juiz-pesquisa":"Juiz de Pesquisa","juiz-core":"Juiz de CORE"},
  menu:{nova:true, reunioes:true, agenda:true, equipes:true, especialistas:true, juizes:true, participantes:true}
};
const clone = o => JSON.parse(JSON.stringify(o));
function cfg(){ return (typeof state !== "undefined" && state.cfg) ? state.cfg : DEFAULT_CFG; }
function rotMin(min){
  if(min % 60 === 0){ const h = min/60; return h + (h === 1 ? " hora antes" : " horas antes"); }
  return min + " minutos antes";
}
function reminders(){
  return (cfg().lembretes || [60,30]).slice().sort((a,b) => b-a).map(min => ({min, rot: rotMin(min)}));
}
const TIPOS = [
  {k:"especialista",  label:"Especialista",     icon:"👤"},
  {k:"juiz-robo",     label:"Juiz de Robô",     icon:"⚖️"},
  {k:"juiz-pesquisa", label:"Juiz de Pesquisa", icon:"⚖️"},
  {k:"juiz-core",     label:"Juiz de CORE",     icon:"⚖️"}
];
const tipoLabel = k => (cfg().rotulos && cfg().rotulos[k]) || (TIPOS.find(t => t.k === k) || {label:"—"}).label;
const tipoIcon  = k => (TIPOS.find(t => t.k === k) || {icon:"👤"}).icon;
const CRIADORES = [
  "Amanda Coradi","Ana Beatriz","Bianca Guimarães","Cauã Lima","Julia Faustino",
  "Eyck Sarmento","Heitor Batista","Sophia de Mattos","Sophia de Campos","Ryan Brugnetti","Luis Guilherme"
];

/* ================= estado ================= */
let state = {
  v: 2,
  cfg: clone(DEFAULT_CFG),
  teams: [
    {id:"t1", nome:"Robotic Generation", logo:"", descricao:"", info:""},
    {id:"t2", nome:"Equipe 02",          logo:"", descricao:"", info:""}
  ],
  people: [],
  participants: [],
  meetings: [],
  fired: [],
  lixeira: []
};
let editingId = null, selParts = [], destino = null, destValor = null, tipoSel = "especialista";
let juizFiltro = "";
let calRef = new Date(), calSel = null;

/* Armazenamento permanente: usa window.storage quando disponível (ambiente de artifact);
   fora dele (arquivo aberto direto no navegador, hospedado em um servidor, etc.) usa IndexedDB,
   que é local ao navegador e sobrevive a fechar a aba, recarregar a página e reiniciar o computador. */
const idbStore = (() => {
  let dbp = null;
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if(typeof indexedDB === "undefined"){ reject(new Error("sem indexedDB")); return; }
      const req = indexedDB.open("genmeet-db", 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function store(mode){ const db = await open(); return db.transaction("kv", mode).objectStore("kv"); }
  return {
    async get(key){
      const s = await store("readonly");
      return new Promise((resolve, reject) => {
        const r = s.get(key);
        r.onsuccess = () => resolve(r.result === undefined ? null : {key, value: r.result});
        r.onerror = () => reject(r.error);
      });
    },
    async set(key, value){
      const s = await store("readwrite");
      return new Promise((resolve, reject) => {
        const r = s.put(value, key);
        r.onsuccess = () => resolve({key, value});
        r.onerror = () => reject(r.error);
      });
    },
    async delete(key){
      const s = await store("readwrite");
      return new Promise((resolve, reject) => {
        const r = s.delete(key);
        r.onsuccess = () => resolve({key, deleted:true});
        r.onerror = () => reject(r.error);
      });
    }
  };
})();
const lsStore = (() => {
  try{
    if(typeof localStorage === "undefined") return null;
    localStorage.setItem("genmeet:teste","1"); localStorage.removeItem("genmeet:teste");
  }catch(e){ return null; }
  return {
    async get(key){ const v = localStorage.getItem(key); return v === null ? null : {key, value:v}; },
    async set(key, value){ localStorage.setItem(key, value); return {key, value}; },
    async delete(key){ localStorage.removeItem(key); return {key, deleted:true}; }
  };
})();
const memStore = (() => {
  const m = new Map();
  return {
    async get(key){ return m.has(key) ? {key, value:m.get(key)} : null; },
    async set(key, value){ m.set(key, value); return {key, value}; },
    async delete(key){ m.delete(key); return {key, deleted:true}; }
  };
})();
const hostStore = (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") ? window.storage : null;
const CHAIN = [hostStore, idbStore, lsStore, memStore].filter(Boolean);
/* grava no primeiro armazenamento que aceitar; lê de todos até achar o dado */
const Store = {
  async get(key){
    for(const st of CHAIN){
      try{ const r = await st.get(key); if(r && r.value != null) return r; }catch(e){}
    }
    return null;
  },
  async set(key, value){
    let erro = null;
    for(const st of CHAIN){
      try{ await st.set(key, value); avisoArmazenamento(st === memStore); return true; }
      catch(e){ erro = e; }
    }
    avisoArmazenamento(true);
    throw erro || new Error("sem armazenamento");
  },
  async delete(key){
    for(const st of CHAIN){ try{ await st.delete(key); }catch(e){} }
    return true;
  }
};
const hasStore = true;
function avisoArmazenamento(semGravacao){
  const el = document.getElementById("storage-warn");
  if(!el) return;
  if(!semGravacao){ el.style.display = "none"; return; }
  if(el.dataset.on === "1") return;
  el.dataset.on = "1";
  el.style.display = "block";
  el.innerHTML = "<b>Os dados estão apenas nesta sessão.</b> Este navegador está bloqueando o armazenamento local — " +
    "costuma acontecer ao abrir o arquivo direto do disco ou em janela anônima. Tudo continua funcionando, mas ao fechar a " +
    "página os dados se perdem. Ligue o servidor compartilhado na aba Conta para guardar os dados fora daqui." +
    '<button onclick="this.parentNode.style.display=\'none\'">fechar</button>';
}

/* ================= utilidades ================= */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch(e) {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==="x"?r:(r&3)|8;return v.toString(16);});
};
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MES3  = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DOWS  = ["dom","seg","ter","qua","qui","sex","sáb"];

const touch = o => { if(o) o.upd = Date.now(); return o; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dt = m => new Date(m.data + "T" + m.hora + ":00");
const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const brDate = s => s.split("-").reverse().join("/");
const sorted = l => l.slice().sort((a,b) => dt(a) - dt(b));
/* agendadas primeiro (mais próximas no topo), depois canceladas, concluídas por último */
const ORDEM = {agendada:0, cancelada:1, concluida:2};
function sortedLista(l){
  return l.slice().sort((a,b) => {
    const ga = ORDEM[a.status] ?? 0, gb = ORDEM[b.status] ?? 0;
    if(ga !== gb) return ga - gb;
    return ga === 0 ? dt(a) - dt(b) : dt(b) - dt(a);
  });
}
const personById = id => state.people.find(p => p.id === id);
const teamById   = id => state.teams.find(t => t.id === id);
const partById   = id => state.participants.find(p => p.id === id);

function destName(m){
  if(m.destinoTipo === "pessoa"){ const p = personById(m.destinoValor); return p ? p.nome : "Pessoa removida"; }
  const t = teamById(m.destinoValor); return t ? t.nome : "Equipe removida";
}
function initials(nome){
  return (nome||"?").trim().split(/\s+/).slice(0,2).map(w => w[0]).join("").toUpperCase();
}
function avatar(src, nome, cls){
  return src
    ? '<span class="avatar ' + (cls||"") + '"><img src="' + src + '" alt=""></span>'
    : '<span class="avatar ' + (cls||"") + '">' + esc(initials(nome)) + "</span>";
}
function humanGap(ms){
  const min = Math.round(ms/60000);
  if(min < 1) return "agora";
  if(min < 60) return min + " min";
  const h = Math.floor(min/60), r = min%60;
  if(h < 24) return h + " h" + (r ? " " + r + " min" : "");
  const d = Math.floor(h/24);
  return d + (d === 1 ? " dia" : " dias") + (h%24 ? " e " + (h%24) + " h" : "");
}
const longDate = d => DOWS[d.getDay()] + ", " + d.getDate() + " de " + MESES[d.getMonth()] + " de " + d.getFullYear();

/* janelas nativas (confirm) são bloqueadas em página incorporada: confirmação própria */
function confirmar(msg, okLabel){
  return new Promise(res => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = '<div class="modal" style="max-width:440px"><h2>Confirmar</h2>' +
      '<p style="margin-top:14px">' + esc(msg) + "</p>" +
      '<div class="cfg-actions" style="margin-top:22px">' +
      '<button class="btn green" data-sim>' + esc(okLabel || "Confirmar") + "</button>" +
      '<button class="btn ghost" data-nao>Voltar</button></div></div>';
    const fim = v => { ov.remove(); res(v); };
    ov.addEventListener("click", e => {
      if(e.target === ov || e.target.closest("[data-nao]")) fim(false);
      else if(e.target.closest("[data-sim]")) fim(true);
    });
    document.body.appendChild(ov);
    const b = ov.querySelector("[data-sim]"); if(b && b.focus) b.focus();
  });
}
async function ask(msg, okLabel){ return cfg().regras.confirmarExclusao ? confirmar(msg, okLabel) : true; }
function toast(title, body, action){
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = "<b>" + esc(title) + "</b><p>" + esc(body || "") + "</p>";
  if(action){
    const b = document.createElement("button");
    b.className = "btn green small"; b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), action ? 30000 : 7000);
}

/* ================= persistência ================= */
function migrate(d){
  if(!d) return null;
  d.people = d.people || [];
  d.participants = d.participants || [];
  d.fired = d.fired || [];
  d.lixeira = d.lixeira || [];
  d.cfg = Object.assign(clone(DEFAULT_CFG), d.cfg || {});
  d.cfg.cores   = Object.assign(clone(DEFAULT_CFG.cores),   d.cfg.cores   || {});
  d.cfg.regras  = Object.assign(clone(DEFAULT_CFG.regras),  d.cfg.regras  || {});
  d.cfg.rotulos = Object.assign(clone(DEFAULT_CFG.rotulos), d.cfg.rotulos || {});
  d.cfg.menu    = Object.assign(clone(DEFAULT_CFG.menu),    d.cfg.menu    || {});
  if(!Array.isArray(d.cfg.lembretes) || !d.cfg.lembretes.length) d.cfg.lembretes = [60,30];
  d.teams = (d.teams || []).map(t => Object.assign({logo:"", descricao:"", info:""}, t));

  if(d.v !== 2){
    const mapP = {};
    (d.meetings || []).forEach(m => {
      if(m.destinoTipo === "especialista"){
        const old = m.destinoValor;
        if(!mapP[old]){
          const core = /core/i.test(old);
          const p = {
            id: uid(),
            tipo: core ? "juiz-core" : "juiz-robo",
            nome: core ? "Juiz de CORE" : "Juiz de Robô (revisar)",
            foto:"", cargo:"", email:"",
            info: "Cadastro migrado da versão anterior (\"" + old + "\"). Revise nome, tipo e e-mail."
          };
          d.people.push(p); mapP[old] = p.id;
        }
        m.destinoTipo = "pessoa";
        m.destinoValor = mapP[old];
      }
      m.participantes = (m.participantes || []).map(n => {
        if(typeof n !== "string") return n;
        let p = d.participants.find(x => x.nome === n);
        if(!p){ p = {id:uid(), nome:n, cargo:"", email:""}; d.participants.push(p); }
        return p.id;
      });
      m.registro = m.registro || {ajudamos:"", ajudados:""};
    });
    d.v = 2;
  }
  (d.meetings || []).forEach(m => { m.registro = m.registro || {ajudamos:"", ajudados:""}; });
  return d;
}

async function load(){
  // O Supabase é a fonte principal dos dados. Não carregar o estado principal
  // do IndexedDB/localStorage para evitar dados antigos ou falsos.
  return true;
}

let dbBaseline = {teams:[], people:[], participants:[], meetings:[]};
let dbLoaded = false;

function dbRows(ids, key){
  const set = new Set((ids || []).map(String));
  return (dbBaseline[key] || []).filter(x => !set.has(String(x.id)));
}

async function carregarDadosSupabase(){
  try{
    setSupabaseStatus("","Carregando...");
    const [eq, esp, jui, par, reu, rp, rs, rj, req, cfgRow] = await Promise.all([
      sb.from('equipes').select('*').order('criado_em'),
      sb.from('especialistas').select('*').order('criado_em'),
      sb.from('juizes').select('*').order('criado_em'),
      sb.from('participantes').select('id,nome,email,cargo,role,ativo,tema,criado_em,atualizado_em').order('criado_em'),
      sb.from('reunioes').select('*').order('data_reuniao',{ascending:true}),
      sb.from('reuniao_participantes').select('*'),
      sb.from('reuniao_especialistas').select('*'),
      sb.from('reuniao_juizes').select('*'),
      sb.from('reuniao_equipes').select('*'),
      sb.from('configuracoes').select('dados').eq('id','global').maybeSingle()
    ]);
    for(const r of [eq,esp,jui,par,reu,rp,rs,rj,req,cfgRow]) if(r.error) throw r.error;

    const people = [];
    (esp.data || []).forEach(x => people.push({id:x.id,tipo:'especialista',nome:x.nome||'',foto:x.foto||'',cargo:x.cargo||'',email:x.email||'',info:x.info||''}));
    (jui.data || []).forEach(x => people.push({id:x.id,tipo:x.tipo||'juiz-robo',nome:x.nome||'',foto:x.foto||'',cargo:x.cargo||'',email:x.email||'',info:x.info||''}));

    const rpBy=new Map(), rsBy=new Map(), rjBy=new Map(), reqBy=new Map();
    (rp.data||[]).forEach(x=>{if(!rpBy.has(x.reuniao_id))rpBy.set(x.reuniao_id,[]);rpBy.get(x.reuniao_id).push(x.participante_id);});
    (rs.data||[]).forEach(x=>{if(!rsBy.has(x.reuniao_id))rsBy.set(x.reuniao_id,[]);rsBy.get(x.reuniao_id).push(x.especialista_id);});
    (rj.data||[]).forEach(x=>{if(!rjBy.has(x.reuniao_id))rjBy.set(x.reuniao_id,[]);rjBy.get(x.reuniao_id).push(x.juiz_id);});
    (req.data||[]).forEach(x=>{if(!reqBy.has(x.reuniao_id))reqBy.set(x.reuniao_id,[]);reqBy.get(x.reuniao_id).push(x.equipe_id);});

    const meetings=(reu.data||[]).map(x=>{
      const spec=(rsBy.get(x.id)||[])[0], juiz=(rjBy.get(x.id)||[])[0], equipe=(reqBy.get(x.id)||[])[0];
      const personId=spec||juiz||null;
      return {
        id:x.id,nome:x.titulo||'',data:x.data_reuniao,hora:(x.hora_inicio||'').slice(0,5),
        destinoTipo:personId?'pessoa':(equipe?'equipe':null),destinoValor:personId||equipe||null,
        participantes:rpBy.get(x.id)||[],status:x.status||'agendada',
        criadoEm:x.criado_em?new Date(x.criado_em).getTime():Date.now(),
        criadoPor:x.criado_por?{id:null,nome:String(x.criado_por),email:''}:null,
        registro:{ajudamos:x.registro_ajudamos||'',ajudados:x.registro_ajudados||''},
        descricao:x.descricao||'',local:x.local||'',observacoes:x.observacoes||''
      };
    });

    state.teams=(eq.data||[]).map(x=>({id:x.id,nome:x.nome||'',logo:x.logo||'',descricao:x.descricao||'',info:x.info||''}));
    state.people=people;
    state.participants=(par.data||[]).map(x=>({id:x.id,usuario_id:null,nome:x.nome||'',cargo:x.cargo||'',email:x.email||'',role:x.role||'pessoa_comum',ativo:x.ativo!==false,tema:x.tema||null}));
    state.meetings=meetings.filter(m=>m.destinoTipo&&m.destinoValor);
    const cfgData=cfgRow.data&&cfgRow.data.dados;
    if(cfgData&&typeof cfgData==='object'){
      state.cfg=Object.assign(clone(DEFAULT_CFG),state.cfg,cfgData);
      state.cfg.cores=Object.assign(clone(DEFAULT_CFG.cores),cfgData.cores||{});
      state.cfg.regras=Object.assign(clone(DEFAULT_CFG.regras),cfgData.regras||{});
      state.cfg.rotulos=Object.assign(clone(DEFAULT_CFG.rotulos),cfgData.rotulos||{});
      state.cfg.menu=Object.assign(clone(DEFAULT_CFG.menu),cfgData.menu||{});
    }
    dbBaseline={teams:clone(state.teams),people:clone(state.people),participants:clone(state.participants),meetings:clone(state.meetings)};
    dbLoaded=true;
    setSupabaseStatus('ok','Supabase conectado');
    return true;
  }catch(e){
    console.error('GenMeet · falha ao carregar Supabase',e);
    setSupabaseStatus('err','Supabase offline');
    toast('Não foi possível conectar ao Supabase',e.message||'Verifique a URL, a chave pública e as políticas RLS.');
    return false;
  }
}

async function syncStateToSupabase(){
  if(!dbLoaded) throw new Error("O Supabase ainda não foi carregado.");

  const teamRows=state.teams.map(t=>({id:t.id,nome:t.nome,descricao:t.descricao||'',logo:t.logo||null,info:t.info||null,ativo:true}));
  const specRows=state.people.filter(p=>p.tipo==='especialista').map(p=>({id:p.id,nome:p.nome,email:p.email||null,cargo:p.cargo||null,ativo:true}));
  const judgeRows=state.people.filter(p=>p.tipo!=='especialista').map(p=>({id:p.id,nome:p.nome,email:p.email||null,telefone:null,tipo:p.tipo||'juiz-robo',ativo:true}));
  const partRows=state.participants.map(p=>({id:p.id,usuario_id:null,nome:p.nome,email:p.email||null,cargo:p.cargo||null,role:p.role||'pessoa_comum',ativo:p.ativo!==false}));
  const meetingRows=state.meetings.map(m=>({
    id:m.id,titulo:m.nome,descricao:m.descricao||null,data_reuniao:m.data_reuniao||m.data,hora_inicio:m.hora||null,hora_fim:null,
    local:m.local||null,status:m.status||'agendada',observacoes:m.observacoes||null,criado_por:(m.criadoPor && (m.criadoPor.nome || m.criadoPor)) || null,registro_ajudamos:(m.registro&&m.registro.ajudamos)||null,registro_ajudados:(m.registro&&m.registro.ajudados)||null
  }));

  // Salva primeiro os cadastros que são referenciados pelas relações.
  // Isso é intencionalmente sequencial: uma reunião nunca tenta criar uma
  // FK para um participante antes de o participante existir no Supabase.
  const upsertConfirmado = async (tabela, rows, label) => {
    if(!rows.length) return;
    const r = await sb.from(tabela).upsert(rows,{onConflict:'id'}).select('id');
    if(r.error) throw r.error;
    if(!Array.isArray(r.data) || r.data.length !== rows.length){
      throw new Error('O Supabase não confirmou todos os registros de ' + label + '.');
    }
  };

  await upsertConfirmado('equipes', teamRows, 'equipes');
  await upsertConfirmado('especialistas', specRows, 'especialistas');
  await upsertConfirmado('juizes', judgeRows, 'juízes');
  await upsertConfirmado('participantes', partRows, 'participantes');

  // Confirma no banco os participantes que serão usados nas FKs.
  const idsParticipantes = [...new Set(
    state.meetings.flatMap(m => Array.isArray(m.participantes) ? m.participantes : [])
      .map(id => String(id))
      .filter(Boolean)
  )];

  if(idsParticipantes.length){
    const ver = await sb.from('participantes').select('id').in('id', idsParticipantes);
    if(ver.error) throw ver.error;

    const existentes = new Set((ver.data || []).map(x => String(x.id)));
    const faltantes = idsParticipantes.filter(id => !existentes.has(id));

    if(faltantes.length){
      const nomes = faltantes.map(id => {
        const p = state.participants.find(x => String(x.id) === id);
        return p?.nome || id;
      });
      throw new Error(
        'Participante não encontrado no Supabase: ' + nomes.join(', ') +
        '. Atualize a página e cadastre o participante novamente.'
      );
    }
  }

  await upsertConfirmado('reunioes', meetingRows, 'reuniões');

  // Remove registros apagados na interface.
  for(const x of dbRows(state.teams,'teams')) { const r=await sb.from('equipes').delete().eq('id',x.id); if(r.error) throw r.error; }
  for(const x of dbRows(state.people,'people')) {
    const r=await sb.from(x.tipo==='especialista'?'especialistas':'juizes').delete().eq('id',x.id); if(r.error) throw r.error;
  }
  for(const x of dbRows(state.participants,'participants')) { const r=await sb.from('participantes').delete().eq('id',x.id); if(r.error) throw r.error; }
  for(const x of dbRows(state.meetings,'meetings')) {
    for(const tabela of ['reuniao_participantes','reuniao_especialistas','reuniao_juizes','reuniao_equipes']) {
      const rel=await sb.from(tabela).delete().eq('reuniao_id',x.id);
      if(rel.error) throw rel.error;
    }
    const r=await sb.from('reunioes').delete().eq('id',x.id).select('id');
    if(r.error) throw r.error;
    if(!r.data || r.data.length!==1) throw new Error('A reunião não foi excluída no Supabase (nenhuma linha afetada).');
  }

  // Recria os vínculos das reuniões.
  for(const m of state.meetings){
    let r=await sb.from('reuniao_participantes').delete().eq('reuniao_id',m.id); if(r.error) throw r.error;
    if(m.participantes && m.participantes.length){
      r=await sb.from('reuniao_participantes').upsert(m.participantes.map(pid=>({reuniao_id:m.id,participante_id:pid})),{onConflict:'reuniao_id,participante_id'});
      if(r.error) throw r.error;
    }
    r=await sb.from('reuniao_especialistas').delete().eq('reuniao_id',m.id); if(r.error) throw r.error;
    r=await sb.from('reuniao_juizes').delete().eq('reuniao_id',m.id); if(r.error) throw r.error;
    r=await sb.from('reuniao_equipes').delete().eq('reuniao_id',m.id); if(r.error) throw r.error;
    if(m.destinoTipo==='equipe' && m.destinoValor){
      r=await sb.from('reuniao_equipes').insert({reuniao_id:m.id,equipe_id:m.destinoValor}); if(r.error) throw r.error;
    }else if(m.destinoTipo==='pessoa' && m.destinoValor){
      const p=personById(m.destinoValor);
      if(p && p.tipo==='especialista') r=await sb.from('reuniao_especialistas').insert({reuniao_id:m.id,especialista_id:p.id});
      else r=await sb.from('reuniao_juizes').insert({reuniao_id:m.id,juiz_id:m.destinoValor});
      if(r.error) throw r.error;
    }
  }

  if(true){
    const cfgPayload={id:'global',dados:state.cfg,atualizado_por:null,atualizado_em:new Date().toISOString()};
    let cr=await sb.from('configuracoes').upsert(cfgPayload,{onConflict:'id'}).select('id');
    if(cr.error) throw cr.error;
    if(!cr.data || cr.data.length!==1) throw new Error('O Supabase não confirmou o salvamento das configurações.');
  }

  dbBaseline={teams:clone(state.teams),people:clone(state.people),participants:clone(state.participants),meetings:clone(state.meetings)};
  return true;
}

/* integridade: nenhuma reunião pode ter pessoa e equipe ao mesmo tempo */
function integrityErrors(s){
  const errs = [];
  s.meetings.forEach(m => {
    const temPessoa = m.destinoTipo === "pessoa" && !!m.destinoValor;
    const temEquipe = m.destinoTipo === "equipe" && !!m.destinoValor;
    if(m.pessoaId && m.equipeId) errs.push(m.nome + ": pessoa e equipe ao mesmo tempo.");
    if(!temPessoa && !temEquipe) errs.push(m.nome + ": destino ausente ou inválido.");
    if(temPessoa && !personById(m.destinoValor)) errs.push(m.nome + ": pessoa do destino não existe mais.");
    if(temEquipe && !teamById(m.destinoValor))   errs.push(m.nome + ": equipe do destino não existe mais.");
  });
  return errs;
}
async function save(){
  const errs=integrityErrors(state);
  if(errs.length){ toast("Salvamento bloqueado",errs[0]+" Corrija antes de continuar."); renderAlert(errs); return false; }
  renderAlert([]);
  try{
    setSupabaseStatus('save','Salvando...');
    if(!dbLoaded) {
      const ok=await carregarDadosSupabase();
      if(!ok) throw new Error('Não foi possível conectar ao Supabase.');
    }
    await syncStateToSupabase();
    statusSalvo();
    return true;
  }catch(e){
    console.error('GenMeet · erro ao salvar',e);
    setSupabaseStatus('err','Não salvo');
    toast('Não foi possível salvar',e.message||'Verifique as permissões do Supabase.');
    return false;
  }
}

let syncTimer = null;
function agendarSync(){
  if(!(cfg().servidor || "").trim()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sincronizar(true), 1500);
}
function renderAlert(errs){
  const box = $("#alert-box");
  if(!box) return;
  box.innerHTML = errs.length
    ? '<div class="card" style="border-color:#8A6A12;margin-bottom:16px"><b>Dados inconsistentes</b><p class="hint">' +
      errs.map(esc).join("<br>") + "</p></div>"
    : "";
}

/* mídia por reunião (fotos e documentos) */
async function loadMedia(id){
  if(!hasStore) return {fotos:[], docs:[]};
  try{
    const r = await Store.get(MEDIA(id));
    return r && r.value ? JSON.parse(r.value) : {fotos:[], docs:[]};
  }catch(e){ return {fotos:[], docs:[]}; }
}
async function saveMedia(id, m){
  if(!hasStore) return false;
  try{ await Store.set(MEDIA(id), JSON.stringify(m)); return true; }
  catch(e){ avisoArmazenamento(true); toast("Não foi possível gravar o arquivo", "Ele vale nesta sessão. Se for muito grande, use uma imagem menor."); return false; }
}
async function dropMedia(id){
  if(!hasStore) return;
  try{ await Store.delete(MEDIA(id)); }catch(e){}
}

/* leitura e compressão de arquivos */
function readFile(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("falha"));
    r.readAsDataURL(file);
  });
}
function shrink(dataUrl, max, quality){
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max/Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", quality || .8));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

/* ================= navegação ================= */
function go(v){
  $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  window.scrollTo({top:0});
  if(v === "painel") renderPainel();
  if(v === "nova") renderPickers();
  if(v === "reunioes") renderList();
  if(v === "agenda") renderCal();
  if(v === "equipes") renderTeams();
  if(v === "especialistas" || v === "juizes") renderPeople();
  if(v === "participantes") renderParts();
  if(v === "config") renderConfig();
  }
$("#nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if(!b) return;
  if(b.dataset.v === "config"){
    const senha=window.prompt("Digite a senha para acessar Configurações:");
    if(senha!=="0910"){ toast("Senha incorreta","Acesso às Configurações bloqueado."); return; }
  }
  go(b.dataset.v);
});
document.addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if(b){ if(b.dataset.go === "nova") resetForm(); go(b.dataset.go); }
});

/* ================= modal ================= */
function openModal(html, onMount, width){
  closeModal();
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = '<div class="modal" style="' + (width ? "max-width:" + width : "") + '">' +
    '<button class="modal-close" aria-label="Fechar">×</button>' + html + "</div>";
  ov.addEventListener("mousedown", e => { if(e.target === ov) closeModal(); });
  ov.querySelector(".modal-close").onclick = closeModal;
  $("#modal-root").appendChild(ov);
  document.body.style.overflow = "hidden";
  if(onMount) onMount(ov);
}
function closeModal(){
  $("#modal-root").innerHTML = "";
  document.body.style.overflow = "";
}
document.addEventListener("keydown", e => { if(e.key === "Escape") closeModal(); });

/* ================= painel ================= */
function renderPainel(){
  renderAlert(integrityErrors(state));
  const now = new Date();
  const futuras = sorted(state.meetings.filter(m => m.status === "agendada" && dt(m) > now));
  const next = futuras[0];

  if(!next){
    $("#hero").innerHTML = '<div class="empty" style="margin-bottom:18px"><strong>Nenhuma reunião no horizonte</strong>' +
      'Assim que você agendar, o painel mostra a contagem e os avisos.' +
      '<div style="margin-top:14px"><button class="btn green" data-go="nova">Agendar reunião</button></div></div>';
  }else{
    const start = dt(next);
    const avisos = reminders().map(r => {
      const at = start.getTime() - r.min*60000;
      const done = now.getTime() >= at;
      const hora = new Date(at).toTimeString().slice(0,5);
      return '<span class="aviso ' + (done ? "done" : "") + '"><i></i>' + r.rot +
        ' <small>' + (done ? "enviado" : "às " + hora) + "</small></span>";
    }).join("");
    $("#hero").innerHTML =
      '<div class="hero"><div class="hero-top"><div>' +
        '<div class="hero-label">Próxima reunião</div><h2>' + esc(next.nome) + "</h2>" +
        '<div class="hero-when">' + longDate(start) + " · " + next.hora + "</div>" +
        '<div style="margin-top:10px">' + badge(next) + "</div></div>" +
        '<div class="count"><b>' + humanGap(start - now) + "</b><span>até começar</span></div></div>" +
      '<div class="avisos"><span class="hero-label" style="width:100%;margin:0">Avisos programados</span>' + avisos + "</div></div>";
  }

  const semana = futuras.filter(m => dt(m) - now < 7*864e5).length;
  $("#stats").innerHTML =
    stat(state.meetings.length, "reuniões registradas", "") +
    stat(state.meetings.filter(m => m.destinoTipo === "pessoa").length, "com pessoas", "b") +
    stat(state.meetings.filter(m => m.destinoTipo === "equipe").length, "com equipes", "g") +
    stat(semana, "nos próximos 7 dias", "b");

  const up = futuras.slice(0,5);
  $("#upcoming").innerHTML = up.length ? up.map(row).join("") :
    '<div class="empty"><strong>Agenda livre</strong>Nada agendado a partir de agora.</div>';
}
const stat = (n, label, cls) => '<div class="stat ' + cls + '"><b>' + n + "</b><span>" + label + "</span></div>";

function badge(m){
  if(m.destinoTipo === "pessoa"){
    const p = personById(m.destinoValor);
    return '<span class="badge pes">' + (p ? tipoIcon(p.tipo) : "👤") + " " + esc(destName(m)) +
      (p ? " · " + esc(tipoLabel(p.tipo)) : "") + "</span>";
  }
  return '<span class="badge eq">👥 ' + esc(destName(m)) + "</span>";
}

/* ================= linha de reunião ================= */
function row(m){
  const d = dt(m);
  const nomes = m.participantes.map(id => (partById(id) || {nome:"—"}).nome);
  return '<article class="row ' + (m.destinoTipo === "equipe" ? "eq " : "") + m.status + '">' +
    '<div class="when"><b>' + d.getDate() + "</b><span>" + MES3[d.getMonth()] + '</span><em>' + m.hora + "</em></div>" +
    '<div class="row-main"><h4>' + esc(m.nome) + '</h4><div class="meta">' + badge(m) +
      '<span class="badge st-' + m.status + '">' + ({agendada:"Agendada",concluida:"Concluída",cancelada:"Cancelada"})[m.status] + "</span>" +
      "<span>" + nomes.length + (nomes.length === 1 ? " participante" : " participantes") + "</span>" +
      "<span>" + esc(nomes.join(", ")) + "</span>" +
      (m.criadoPor ? "<span>criada por " + esc(m.criadoPor.nome) + "</span>" : "") + "</div></div>" +
    '<div class="row-acts">' +
      '<button class="btn ghost small" data-act="detalhes" data-id="' + m.id + '">Detalhes</button>' +
      (m.status === "agendada" ? '<button class="btn green small" data-act="concluir" data-id="' + m.id + '">Concluir</button>' : "") +
      '<button class="btn ghost small" data-act="editar" data-id="' + m.id + '">Editar</button>' +
      (m.status === "cancelada"
        ? '<button class="btn ghost small" data-act="reabrir" data-id="' + m.id + '">Reabrir</button>'
        : '<button class="btn ghost small" data-act="cancelar" data-id="' + m.id + '">Cancelar</button>') +
      '<button class="btn ghost small" data-act="excluir" data-id="' + m.id + '">Excluir</button>' +
    "</div></article>";
}

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if(!b) return;
  const m = state.meetings.find(x => x.id === b.dataset.id); if(!m) return;
  const a = b.dataset.act;
  if(a === "detalhes"){ openDetalhes(m.id); return; }
  if(a === "editar"){ loadForm(m); go("nova"); return; }
  let concluida = false;
  if(a === "concluir"){
    if(!await ask("Concluir a reunião \"" + m.nome + "\"?")) return;
    m.status = "concluida"; concluida = true;
  }
  if(a === "cancelar"){ if(!await ask("Cancelar a reunião \"" + m.nome + "\"?")) return; m.status = "cancelada"; }
  if(a === "reabrir") m.status = "agendada";
  touch(m);
  if(a === "excluir"){
    if(!await ask("Excluir a reunião \"" + m.nome + "\"? Registro, fotos e documentos vão junto.")) return;
    const senha=window.prompt("Digite a senha para excluir a reunião:");
    if(senha!=="0910"){ toast("Senha incorreta","A reunião não foi excluída."); return; }
    state.meetings = state.meetings.filter(x => x.id !== m.id);
    state.lixeira.push({id:m.id, upd:Date.now()});
    await dropMedia(m.id);
  }
  if(!await save()) return;
  if(a === "excluir") toast("Reunião excluída", m.nome);
  renderAll();
  if(concluida){
    toast("Reunião concluída", "Agora registre o que foi tratado e anexe fotos ou documentos.");
    openDetalhes(m.id, "registro");
  }
});

/* ================= detalhes da reunião ================= */
async function openDetalhes(id){
  const m = state.meetings.find(x => x.id === id); if(!m) return;
  const media = await loadMedia(id);
  const p = m.destinoTipo === "pessoa" ? personById(m.destinoValor) : null;
  const t = m.destinoTipo === "equipe" ? teamById(m.destinoValor) : null;
  const nomes = m.participantes.map(x => (partById(x) || {nome:"—"}).nome).join(", ");
  const concl = m.status === "concluida";

  openModal(
    "<h2>" + esc(m.nome) + "</h2>" +
    '<div style="margin-top:10px">' + badge(m) + ' <span class="badge st-' + m.status + '">' +
      ({agendada:"Agendada",concluida:"Concluída",cancelada:"Cancelada"})[m.status] + "</span></div>" +
    '<dl class="kv"><dt>Data</dt><dd>' + brDate(m.data) + "</dd>" +
      "<dt>Hora</dt><dd>" + m.hora + "</dd>" +
      "<dt>Destino</dt><dd>" + (p ? esc(p.nome) + " · " + esc(tipoLabel(p.tipo)) + (p.cargo ? " · " + esc(p.cargo) : "") +
        (p.email ? "<br>" + esc(p.email) : "") : esc(t ? t.nome : "—") + (t && t.descricao ? "<br>" + esc(t.descricao) : "")) + "</dd>" +
      "<dt>Participantes</dt><dd>" + esc(nomes || "—") + "</dd>" +
      (m.criadoPor ? "<dt>Criada por</dt><dd>" + esc(m.criadoPor.nome) + " · " + esc(m.criadoPor.email || "") + "</dd>" : "") + "</dl>" +

    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">' +
      '<button class="btn green small" id="d-teste">Testar aviso agora</button></div>' +

    '<div class="modal-sec"><h3>Registro</h3>' +
      (concl ? "" : '<p class="hint" style="margin-bottom:10px">O registro fica disponível depois de concluir a reunião.</p>') +
      '<div class="field"><label for="r-a">O que ajudamos?</label>' +
        '<textarea class="input" id="r-a" ' + (concl ? "" : "disabled") + ">" + esc(m.registro.ajudamos) + "</textarea></div>" +
      '<div class="field" style="margin-top:12px"><label for="r-b">O que fomos ajudados?</label>' +
        '<textarea class="input" id="r-b" ' + (concl ? "" : "disabled") + ">" + esc(m.registro.ajudados) + "</textarea></div>" +
      (concl ? '<div style="margin-top:12px"><button class="btn green small" id="r-save">Salvar registro</button></div>' : "") +
    "</div>" +

    '<div class="modal-sec"><h3>Fotos</h3>' +
      '<input type="file" id="f-fotos" accept="image/*" multiple class="input" style="padding:8px">' +
      '<div class="thumbs" id="thumbs"></div></div>' +

    '<div class="modal-sec"><h3>Documentos</h3>' +
      '<input type="file" id="f-docs" multiple class="input" style="padding:8px">' +
      '<div id="docs"></div></div>',

    ov => {
      const drawFotos = () => {
        $("#thumbs").innerHTML = media.fotos.length ? media.fotos.map(f =>
          '<div class="thumb"><img src="' + f.dataUrl + '" alt=""><button data-foto="' + f.id + '">excluir</button></div>').join("")
          : '<p class="hint">Nenhuma foto vinculada.</p>';
      };
      const drawDocs = () => {
        $("#docs").innerHTML = media.docs.length ? media.docs.map(d =>
          '<div class="doc"><span class="ic">' + docIcon(d) + '</span><div class="info"><b>' + esc(d.nome) +
          "</b><span>" + esc(docKind(d)) + '</span></div><div class="acts">' +
          '<button class="btn ghost small" data-open="' + d.id + '">Abrir</button> ' +
          '<button class="btn ghost small" data-doc="' + d.id + '">Excluir</button></div></div>').join("")
          : '<p class="hint">Nenhum documento vinculado.</p>';
      };
      drawFotos(); drawDocs();

      ov.querySelector("#d-teste").onclick = () => { closeModal(); dispararAviso(m, "1 hora antes", true); };

      const rs = ov.querySelector("#r-save");
      if(rs) rs.onclick = async () => {
        m.registro = {ajudamos: ov.querySelector("#r-a").value.trim(), ajudados: ov.querySelector("#r-b").value.trim()};
        touch(m);
        if(await save()) toast("Registro salvo", m.nome);
      };

      ov.querySelector("#f-fotos").onchange = async ev => {
        for(const file of Array.from(ev.target.files)){
          const raw = await readFile(file);
          media.fotos.push({id:uid(), nome:file.name, dataUrl: await shrink(raw, 1100, .78)});
        }
        ev.target.value = "";
        if(await saveMedia(id, media)) toast("Fotos adicionadas", m.nome);
        drawFotos();
      };
      ov.querySelector("#f-docs").onchange = async ev => {
        for(const file of Array.from(ev.target.files)){
          if(file.size > 3.5*1024*1024){ toast("Arquivo muito grande", file.name + " passa de 3,5 MB."); continue; }
          media.docs.push({id:uid(), nome:file.name, mime:file.type, dataUrl: await readFile(file)});
        }
        ev.target.value = "";
        if(await saveMedia(id, media)) toast("Documentos anexados", m.nome);
        drawDocs();
      };
      ov.addEventListener("click", async ev => {
        const fb = ev.target.closest("[data-foto]");
        const db = ev.target.closest("[data-doc]");
        const ob = ev.target.closest("[data-open]");
        if(fb){ media.fotos = media.fotos.filter(f => f.id !== fb.dataset.foto); await saveMedia(id, media); drawFotos(); }
        if(db){ media.docs = media.docs.filter(d => d.id !== db.dataset.doc); await saveMedia(id, media); drawDocs(); }
        if(ob){
          const d = media.docs.find(x => x.id === ob.dataset.open);
          if(d) baixar(d.dataUrl, d.nome);
        }
      });
    }, "760px");
}
function docKind(d){
  const e = (d.nome.split(".").pop() || "").toUpperCase();
  const map = {PDF:"PDF", DOC:"Word", DOCX:"Word", XLS:"Excel", XLSX:"Excel", CSV:"Planilha",
    PPT:"PowerPoint", PPTX:"PowerPoint", PNG:"Imagem", JPG:"Imagem", JPEG:"Imagem", WEBP:"Imagem", GIF:"Imagem"};
  return map[e] || (e ? "Arquivo " + e : "Arquivo");
}
function docIcon(d){
  const k = docKind(d);
  return ({PDF:"📕", Word:"📘", Excel:"📗", Planilha:"📗", PowerPoint:"📙", Imagem:"🖼️"})[k] || "📄";
}
function baixar(dataUrl, nome){
  const a = document.createElement("a");
  a.href = dataUrl; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
}

/* ================= avisos na tela ================= */
/* O GenMeet não envia e-mail. Os lembretes aparecem como aviso dentro do site
   e, se você autorizar, como notificação do navegador. */
function dispararAviso(m, rot, teste){
  const quem = (m.destinoTipo === "pessoa" ? "\u{1F464} " : "\u{1F465} ") + destName(m);
  const titulo = (teste ? "Teste \u00b7 " : "Lembrete \u00b7 ") + rot;
  const nomes = m.participantes.map(id => (partById(id) || {nome:"\u2014"}).nome).join(", ");
  toast(titulo, m.nome + " \u00e0s " + m.hora + " \u00b7 " + quem + (nomes ? " \u00b7 " + nomes : ""));
  try{
    if(cfg().notificacoes && window.Notification && Notification.permission === "granted")
      new Notification(cfg().nome + " \u00b7 " + rot, {body: m.nome + " \u00e0s " + m.hora + " \u2014 " + quem});
  }catch(e){}
}

/* ================= formulário de reunião ================= */
function resetForm(){
  editingId = null; selParts = []; destino = null; destValor = null; tipoSel = "especialista";
  $("#form").reset();
  $("#f-criador").value = "";
  $("#form-title").textContent = "Nova reunião";
  $("#save-btn").textContent = "Salvar reunião";
  $("#cancel-edit").style.display = "none";
  renderPickers(); renderChips(); clearErrors();
}
function loadForm(m){
  editingId = m.id;
  $("#f-nome").value = m.nome; $("#f-data").value = m.data; $("#f-hora").value = m.hora;
  $("#f-criador").value = m.criadoPor ? (m.criadoPor.nome || m.criadoPor) : "";
  destino = m.destinoTipo; destValor = m.destinoValor;
  if(destino === "pessoa"){ const p = personById(m.destinoValor); if(p) tipoSel = p.tipo; }
  selParts = m.participantes.slice();
  $("#form-title").textContent = "Editar reunião";
  $("#save-btn").textContent = "Salvar alterações";
  $("#cancel-edit").style.display = "inline-flex";
  renderPickers(); renderChips(); clearErrors();
}
$("#cancel-edit").addEventListener("click", () => { resetForm(); go("reunioes"); });

function renderPickers(){
  $$(".dest-opt").forEach(o => {
    const k = o.dataset.k;
    o.classList.toggle("sel", destino === k);
    o.classList.toggle("locked", destino !== null && destino !== k);
  });
  $("#pick-pes").classList.toggle("on", destino === "pessoa");
  $("#pick-eq").classList.toggle("on", destino === "equipe");
  $("#dest-note").textContent = destino
    ? "Destino travado em " + (destino === "pessoa" ? "pessoa" : "equipe") + ". Clique de novo no cartão para trocar."
    : "Escolha um dos dois. Ao selecionar, o outro fica bloqueado.";

  $("#tipo-chips").innerHTML = TIPOS.map(t =>
    '<button type="button" class="tchip ' + (tipoSel === t.k ? "on" : "") + '" data-tipo="' + t.k + '">' +
    t.icon + " " + t.label + "</button>").join("");

  const pessoas = state.people.filter(p => p.tipo === tipoSel);
  $("#people-pick").innerHTML = pessoas.map(p =>
    '<button type="button" class="pcard ' + (destValor === p.id ? "sel" : "") + '" data-pessoa="' + p.id + '">' +
    avatar(p.foto, p.nome) + '<span class="info"><b>' + esc(p.nome) + "</b>" +
    "<span>" + esc(p.cargo || tipoLabel(p.tipo)) + "</span>" +
    "<span>" + esc(p.email || "sem e-mail") + "</span></span></button>").join("") +
    '<button type="button" class="pcard add" data-nova-pessoa="1"><span class="avatar">＋</span>' +
    '<span class="info"><b>Cadastrar ' + esc(tipoLabel(tipoSel)) + "</b>" +
    "<span>" + (pessoas.length ? "sem sair desta tela" : "nenhum cadastrado ainda") + "</span></span></button>";

  $("#team-pick").innerHTML = state.teams.map(t =>
    '<button type="button" class="pcard ' + (destValor === t.id ? "sel" : "") + '" data-equipe="' + t.id + '">' +
    avatar(t.logo, t.nome) + '<span class="info"><b>' + esc(t.nome) + "</b>" +
    "<span>" + esc(t.descricao || "sem descrição") + "</span></span></button>").join("") +
    '<button type="button" class="pcard add" data-nova-equipe="1"><span class="avatar">＋</span>' +
    '<span class="info"><b>Cadastrar equipe</b>' +
    "<span>" + (state.teams.length ? "sem sair desta tela" : "nenhuma cadastrada ainda") + "</span></span></button>";

  const livres = state.participants.filter(p => !selParts.includes(p.id));
  $("#f-part").innerHTML = livres.length
    ? '<option value="">Selecione um participante</option>' +
      livres.map(p => '<option value="' + p.id + '">' + esc(p.nome) + (p.cargo ? " — " + esc(p.cargo) : "") + "</option>").join("")
    : '<option value="">' + (state.participants.length ? "Todos já adicionados" : "Cadastre participantes primeiro") + "</option>";
}
$$(".dest-opt").forEach(o => o.addEventListener("click", () => {
  const k = o.dataset.k;
  if(destino === k){ destino = null; destValor = null; }
  else { destino = k; destValor = null; }
  renderPickers();
}));
$("#tipo-chips").addEventListener("click", e => {
  const b = e.target.closest("[data-tipo]");
  if(b){ tipoSel = b.dataset.tipo; destValor = null; renderPickers(); }
});
$("#people-pick").addEventListener("click", e => {
  if(e.target.closest("[data-nova-pessoa]")){
    personModal(null, tipoSel, id => {
      const p = personById(id);
      if(p){ tipoSel = p.tipo; destino = "pessoa"; destValor = p.id; }
      renderPickers();
    });
    return;
  }
  const b = e.target.closest("[data-pessoa]");
  if(b){ destino = "pessoa"; destValor = b.dataset.pessoa; renderPickers(); }
});
$("#team-pick").addEventListener("click", e => {
  if(e.target.closest("[data-nova-equipe]")){
    teamModal(null, id => { destino = "equipe"; destValor = id; renderPickers(); });
    return;
  }
  const b = e.target.closest("[data-equipe]");
  if(b){ destino = "equipe"; destValor = b.dataset.equipe; renderPickers(); }
});
$("#new-part-inline").addEventListener("click", () => {
  partModal(null, id => {
    if(!selParts.includes(id)) selParts.push(id);
    renderChips(); renderPickers();
  });
});
function renderChips(){
  $("#chips").innerHTML = selParts.map(id => {
    const p = partById(id) || {nome:"—"};
    return '<span class="chip">' + esc(p.nome) + '<button type="button" data-rm="' + id + '" aria-label="Remover">×</button></span>';
  }).join("");
}
$("#chips").addEventListener("click", e => {
  const b = e.target.closest("[data-rm]");
  if(b){ selParts = selParts.filter(x => x !== b.dataset.rm); renderChips(); renderPickers(); }
});
$("#add-part").addEventListener("click", () => {
  const v = $("#f-part").value;
  if(!v){
    if(!state.participants.length) toast("Nenhum participante cadastrado", "Use \"+ Cadastrar participante\" ao lado.");
    return;
  }
  if(!selParts.includes(v)) selParts.push(v);
  renderChips(); renderPickers();
});

function clearErrors(){ $$(".err-msg").forEach(x => x.classList.remove("on")); $$(".input").forEach(i => i.classList.remove("err")); }
function fail(id, field, msg){
  const e = $("#e-" + id); if(msg) e.textContent = msg; e.classList.add("on");
  if(field) $(field).classList.add("err");
}

let salvando = false;
async function salvarReuniao(ev){
  if(ev) ev.preventDefault();
  if(salvando) return;
  salvando = true;
  try{ await salvarReuniaoInterno(); }
  catch(err){
    console.error("GenMeet · falha ao salvar:", err);
    toast("Erro ao salvar", (err && err.message ? err.message : String(err)) + " — avise que apareceu esta mensagem.");
  }
  finally{ salvando = false; }
}
async function salvarReuniaoInterno(){
  clearErrors();
  const nome = $("#f-nome").value.trim(), data = $("#f-data").value, hora = $("#f-hora").value, criador = $("#f-criador").value;
  let ok = true;
  const faltando = [];

  if(!nome){ fail("nome","#f-nome"); faltando.push("nome da reunião"); ok = false; }
  if(!data){ fail("data","#f-data"); faltando.push("data"); ok = false; }
  else if(cfg().regras.bloquearPassado && data < iso(new Date())){
    fail("data","#f-data","A data não pode ser anterior a hoje."); faltando.push("data válida (hoje ou depois)"); ok = false; }
  if(!hora){ fail("hora","#f-hora"); faltando.push("hora"); ok = false; }
  if(!criador){ fail("criador","#f-criador","Escolha quem criou a reunião."); faltando.push("quem criou a reunião"); ok = false; }

  if(!destino){ fail("dest", null, "Escolha o destino: pessoa ou equipe."); faltando.push("destino (pessoa ou equipe)"); ok = false; }
  else if(!destValor){ fail("dest", null, destino === "pessoa" ? "Selecione a pessoa." : "Selecione a equipe.");
    faltando.push(destino === "pessoa" ? "selecionar a pessoa" : "selecionar a equipe"); ok = false; }
  else if(destino === "pessoa" && !personById(destValor)){ fail("dest", null, "Pessoa inválida. Selecione novamente."); faltando.push("pessoa válida"); ok = false; }
  else if(destino === "equipe" && !teamById(destValor)){ fail("dest", null, "Equipe inválida. Selecione novamente."); faltando.push("equipe válida"); ok = false; }
  if(cfg().regras.participantesObrig && !selParts.length){ fail("part","#f-part"); faltando.push("ao menos um participante"); ok = false; }
  if(!ok){
    toast("Falta preencher", faltando.join(" · "));
    const primeiroErro = $(".err-msg.on");
    if(primeiroErro && primeiroErro.scrollIntoView) primeiroErro.scrollIntoView({block:"center"});
    return;
  }

  const payload = {nome, data, hora, destinoTipo: destino, destinoValor: destValor, participantes: selParts.slice(), criadoPor:{id:null,nome:criador,email:""}};
  let alvo;
  if(editingId){
    alvo = state.meetings.find(x => x.id === editingId);
    const mudouHorario = alvo.data !== data || alvo.hora !== hora;
    Object.assign(alvo, payload);
    delete alvo.pessoaId; delete alvo.equipeId;
    if(mudouHorario) state.fired = state.fired.filter(f => !f.startsWith(editingId + ":"));
    touch(alvo);
  }else{
    alvo = Object.assign({id:uid(), status:"agendada", criadoEm:Date.now(), registro:{ajudamos:"",ajudados:""},
      criadoPor: payload.criadoPor || null}, payload);
    touch(alvo);
    state.meetings.push(alvo);
  }
  if(!await save()){ if(!editingId) state.meetings = state.meetings.filter(x => x.id !== alvo.id); return; }
  toast(editingId ? "Reunião atualizada" : "Reunião salva", nome + (editingId ? "" : " · criada por " + criador));
  resetForm(); renderAll(); go("reunioes");
}
$("#save-btn").addEventListener("click", salvarReuniao);
$("#form").addEventListener("submit", salvarReuniao);

/* ================= lista e filtros ================= */
function fillCriadores(){
  const sel=$("#f-criador"); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">Selecione quem criou a reunião</option>'+CRIADORES.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join("");
  sel.value=cur;
}

function fillQuem(){
  const sel = $("#f-quem"), cur = sel.value;
  let html = '<option value="">Todos</option>';
  TIPOS.forEach(t => {
    const pes = state.people.filter(p => p.tipo === t.k);
    if(pes.length) html += '<optgroup label="' + t.label + '">' +
      pes.map(p => '<option value="p:' + p.id + '">' + esc(p.nome) + "</option>").join("") + "</optgroup>";
  });
  if(state.teams.length) html += '<optgroup label="Equipes">' +
    state.teams.map(t => '<option value="e:' + t.id + '">' + esc(t.nome) + "</option>").join("") + "</optgroup>";
  sel.innerHTML = html; sel.value = cur;
}
function filtered(){
  const q = $("#q").value.trim().toLowerCase();
  const fd = $("#f-dest").value, fq = $("#f-quem").value, fs = $("#f-status").value;
  return sortedLista(state.meetings.filter(m => {
    if(fd && m.destinoTipo !== fd) return false;
    if(fs && m.status !== fs) return false;
    if(fq){
      const k = fq.slice(0,1), v = fq.slice(2);
      if(k === "p" && !(m.destinoTipo === "pessoa" && m.destinoValor === v)) return false;
      if(k === "e" && !(m.destinoTipo === "equipe" && m.destinoValor === v)) return false;
    }
    if(q){
      const p = m.destinoTipo === "pessoa" ? personById(m.destinoValor) : null;
      const hay = [m.nome, destName(m), p ? tipoLabel(p.tipo) : "", brDate(m.data), m.hora, m.status,
        m.participantes.map(id => { const x = partById(id); return x ? x.nome + " " + x.cargo : ""; }).join(" "),
        m.registro.ajudamos, m.registro.ajudados].join(" ").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }));
}
function renderList(){
  fillQuem();
  const l = filtered();
  $("#list").innerHTML = l.length ? l.map(row).join("") :
    (state.meetings.length
      ? '<div class="empty"><strong>Nada encontrado</strong>Ajuste a busca ou os filtros acima.</div>'
      : '<div class="empty"><strong>Nenhuma reunião ainda</strong>Comece agendando a primeira.' +
        '<div style="margin-top:14px"><button class="btn green" data-go="nova">Nova reunião</button></div></div>');
}
["#q","#f-dest","#f-quem","#f-status"].forEach(s => $(s).addEventListener("input", renderList));

$("#print-btn").addEventListener("click", () => {
  const l = filtered();
  if(!l.length){ toast("Nada para imprimir", "A lista filtrada está vazia."); return; }
  $("#print-area").innerHTML =
    "<h1>GenMeet — reuniões</h1><p class='p-sub'>Emitido em " + longDate(new Date()) + " · " + l.length + " registro(s)</p>" +
    "<table><thead><tr><th>Data</th><th>Hora</th><th>Reunião</th><th>Destino</th><th>Participantes</th><th>Situação</th></tr></thead><tbody>" +
    l.map(m => "<tr><td>" + brDate(m.data) + "</td><td>" + m.hora + "</td><td>" + esc(m.nome) + "</td><td>" +
      (m.destinoTipo === "pessoa" ? "Pessoa: " : "Equipe: ") + esc(destName(m)) + "</td><td>" +
      esc(m.participantes.map(id => (partById(id)||{nome:"—"}).nome).join(", ")) + "</td><td>" + m.status + "</td></tr>").join("") +
    "</tbody></table>";
  window.print();
});

/* ================= agenda ================= */
$("#cal-dows").innerHTML = DOWS.map(d => '<div class="dow">' + d + "</div>").join("");
$("#cal-prev").addEventListener("click", () => { calRef.setMonth(calRef.getMonth()-1); renderCal(); });
$("#cal-next").addEventListener("click", () => { calRef.setMonth(calRef.getMonth()+1); renderCal(); });
function renderCal(){
  const y = calRef.getFullYear(), mo = calRef.getMonth();
  $("#cal-title").textContent = MESES[mo].charAt(0).toUpperCase() + MESES[mo].slice(1) + " de " + y;
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay()), today = iso(new Date());
  let html = "";
  for(let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const k = iso(d), dayM = state.meetings.filter(m => m.data === k);
    html += '<button class="day' + (d.getMonth() !== mo ? " out" : "") + (k === today ? " today" : "") +
      (k === calSel ? " sel" : "") + '" data-day="' + k + '"><span class="n">' + d.getDate() + "</span>" +
      '<span class="pips">' + dayM.slice(0,6).map(m => '<span class="pip' + (m.destinoTipo === "equipe" ? " eq" : "") + '"></span>').join("") +
      "</span></button>";
  }
  $("#cal").innerHTML = html;
  renderCalDay();
}
$("#cal").addEventListener("click", e => {
  const b = e.target.closest("[data-day]");
  if(b){ calSel = b.dataset.day; renderCal(); }
});
function renderCalDay(){
  if(!calSel){
    $("#cal-day-title").textContent = "Selecione um dia";
    $("#cal-rows").innerHTML = '<div class="empty">Toque em um dia do calendário para ver as reuniões.</div>';
    return;
  }
  const [y,m,d] = calSel.split("-").map(Number);
  $("#cal-day-title").textContent = longDate(new Date(y, m-1, d));
  const l = sortedLista(state.meetings.filter(x => x.data === calSel));
  $("#cal-rows").innerHTML = l.length ? l.map(row).join("") :
    '<div class="empty"><strong>Dia livre</strong>Nenhuma reunião nesta data.' +
    '<div style="margin-top:14px"><button class="btn green" data-go="nova">Agendar</button></div></div>';
}

/* ================= equipes ================= */
function renderTeams(){
  $("#teams").innerHTML = state.teams.length ? state.teams.map(t => {
    const n = state.meetings.filter(m => m.destinoTipo === "equipe" && m.destinoValor === t.id).length;
    return '<div class="crud">' + avatar(t.logo, t.nome) +
      '<div class="info"><b>' + esc(t.nome) + "</b><span>" + esc(t.descricao || "sem descrição") + "</span>" +
      '<span>' + n + (n === 1 ? " reunião vinculada" : " reuniões vinculadas") + "</span></div>" +
      '<div class="acts"><button class="btn ghost small" data-team-edit="' + t.id + '">Editar</button>' +
      '<button class="btn ghost small" data-team-del="' + t.id + '">Remover</button></div></div>';
  }).join("") : '<div class="empty"><strong>Nenhuma equipe cadastrada</strong>Cadastre uma equipe para agendar reuniões com equipe.</div>';
}
function teamModal(t, onDone){
  const novo = !t;
  t = t || {id:uid(), nome:"", logo:"", descricao:"", info:""};
  openModal(
    "<h2>" + (novo ? "Cadastrar equipe" : "Editar equipe") + "</h2>" +
    '<div class="form" style="margin-top:18px">' +
      '<div class="field"><label for="t-nome">Nome da equipe</label><input class="input" id="t-nome" value="' + esc(t.nome) + '"></div>' +
      '<div class="field"><label for="t-logo">Logo da equipe</label>' +
        '<div style="display:flex;gap:12px;align-items:center">' + avatar(t.logo, t.nome || "?", "lg") +
        '<input type="file" class="input" id="t-logo" accept="image/*" style="padding:8px"></div></div>' +
      '<div class="field"><label for="t-desc">Descrição</label><textarea class="input" id="t-desc">' + esc(t.descricao) + "</textarea></div>" +
      '<div class="field"><label for="t-info">Informações da equipe</label><textarea class="input" id="t-info">' + esc(t.info) + "</textarea></div>" +
      '<div class="form-actions"><button class="btn green" id="t-save">' + (novo ? "Cadastrar equipe" : "Salvar alterações") + "</button>" +
      '<button class="btn ghost" id="t-cancel">Cancelar</button></div></div>',
    ov => {
      let logo = t.logo;
      ov.querySelector("#t-logo").onchange = async ev => {
        const f = ev.target.files[0]; if(!f) return;
        logo = await shrink(await readFile(f), 320, .85);
        ov.querySelector(".avatar").outerHTML = avatar(logo, "", "lg");
      };
      ov.querySelector("#t-cancel").onclick = closeModal;
      ov.querySelector("#t-save").onclick = async () => {
        const nome = ov.querySelector("#t-nome").value.trim();
        if(!nome){ toast("Informe o nome", "A equipe precisa de um nome."); return; }
        const dados = {nome, logo, descricao: ov.querySelector("#t-desc").value.trim(), info: ov.querySelector("#t-info").value.trim()};
        if(novo) state.teams.push(touch(Object.assign({id:t.id}, dados)));
        else touch(Object.assign(teamById(t.id), dados));
        if(await save()){
          closeModal(); renderAll();
          if(onDone) onDone(t.id);
          toast(novo ? "Equipe cadastrada" : "Equipe atualizada", nome);
        }
      };
    });
}
$("#new-team").addEventListener("click", () => teamModal(null));
$("#teams").addEventListener("click", async e => {
  const ed = e.target.closest("[data-team-edit]"), dl = e.target.closest("[data-team-del]");
  if(ed) teamModal(teamById(ed.dataset.teamEdit));
  if(dl){
    const id = dl.dataset.teamDel;
    const n = state.meetings.filter(m => m.destinoTipo === "equipe" && m.destinoValor === id).length;
    if(n){ toast("Equipe em uso", "Há " + n + " reunião(ões) vinculada(s). Exclua ou altere essas reuniões primeiro."); return; }
    if(!await ask("Remover a equipe \"" + teamById(id).nome + "\"?")) return;
    state.teams = state.teams.filter(t => t.id !== id);
    state.lixeira.push({id, upd:Date.now()});
    await save(); renderAll();
  }
});

/* ================= pessoas: especialistas e juízes ================= */
function renderPeople(){
  const esp = state.people.filter(p => p.tipo === "especialista");
  $("#especialistas").innerHTML = esp.length ? esp.map(personRow).join("")
    : '<div class="empty"><strong>Nenhum especialista cadastrado</strong>Cadastre para poder agendar reuniões com especialistas.</div>';

  $("#juiz-filtro").innerHTML = ['<button class="tchip ' + (juizFiltro === "" ? "on" : "") + '" data-jf="">Todos</button>']
    .concat(TIPOS.filter(t => t.k !== "especialista").map(t =>
      '<button class="tchip ' + (juizFiltro === t.k ? "on" : "") + '" data-jf="' + t.k + '">' + t.icon + " " + t.label + "</button>")).join("");

  const jui = state.people.filter(p => p.tipo !== "especialista" && (!juizFiltro || p.tipo === juizFiltro));
  $("#juizes").innerHTML = jui.length ? jui.map(personRow).join("")
    : '<div class="empty"><strong>Nenhum juiz nesta categoria</strong>Cadastre juízes de Robô, de Pesquisa e de CORE separadamente.</div>';
}
function personRow(p){
  const n = state.meetings.filter(m => m.destinoTipo === "pessoa" && m.destinoValor === p.id).length;
  return '<div class="crud">' + avatar(p.foto, p.nome) +
    '<div class="info"><b>' + esc(p.nome) + "</b>" +
    "<span>" + tipoIcon(p.tipo) + " " + esc(tipoLabel(p.tipo)) + (p.cargo ? " · " + esc(p.cargo) : "") + "</span>" +
    "<span>" + esc(p.email || "sem e-mail") + " · " + n + (n === 1 ? " reunião" : " reuniões") + "</span></div>" +
    '<div class="acts"><button class="btn ghost small" data-person-edit="' + p.id + '">Editar</button>' +
    '<button class="btn ghost small" data-person-del="' + p.id + '">Remover</button></div></div>';
}
function personModal(p, tipoPadrao, onDone){
  const novo = !p;
  p = p || {id:uid(), tipo: tipoPadrao || "especialista", nome:"", foto:"", cargo:"", email:"", info:""};
  openModal(
    "<h2>" + (novo ? "Cadastrar pessoa" : "Editar pessoa") + "</h2>" +
    '<div class="form" style="margin-top:18px">' +
      '<div class="field"><span class="lbl">Tipo</span><div class="tchips" id="p-tipos">' +
        TIPOS.map(t => '<button type="button" class="tchip ' + (p.tipo === t.k ? "on" : "") + '" data-pt="' + t.k + '">' +
          t.icon + " " + t.label + "</button>").join("") + "</div></div>" +
      '<div class="field"><label for="p-nome">Nome</label><input class="input" id="p-nome" value="' + esc(p.nome) + '"></div>' +
      '<div class="field"><label for="p-foto">Foto</label><div style="display:flex;gap:12px;align-items:center">' +
        avatar(p.foto, p.nome || "?", "lg") + '<input type="file" class="input" id="p-foto" accept="image/*" style="padding:8px"></div></div>' +
      '<div class="grid2">' +
        '<div class="field"><label for="p-cargo">Cargo/Função</label><input class="input" id="p-cargo" value="' + esc(p.cargo) + '"></div>' +
        '<div class="field"><label for="p-email">E-mail</label><input class="input" id="p-email" type="email" value="' + esc(p.email) + '"></div>' +
      "</div>" +
      '<div class="field"><label for="p-info">Informações adicionais</label><textarea class="input" id="p-info">' + esc(p.info) + "</textarea></div>" +
      '<div class="form-actions"><button class="btn green" id="p-save">' + (novo ? "Cadastrar" : "Salvar alterações") + "</button>" +
      '<button class="btn ghost" id="p-cancel">Cancelar</button></div></div>',
    ov => {
      let tipo = p.tipo, foto = p.foto;
      ov.querySelector("#p-tipos").onclick = ev => {
        const b = ev.target.closest("[data-pt]"); if(!b) return;
        tipo = b.dataset.pt;
        ov.querySelectorAll("[data-pt]").forEach(x => x.classList.toggle("on", x.dataset.pt === tipo));
      };
      ov.querySelector("#p-foto").onchange = async ev => {
        const f = ev.target.files[0]; if(!f) return;
        foto = await shrink(await readFile(f), 320, .85);
        ov.querySelector(".avatar").outerHTML = avatar(foto, "", "lg");
      };
      ov.querySelector("#p-cancel").onclick = closeModal;
      ov.querySelector("#p-save").onclick = async () => {
        const nome = ov.querySelector("#p-nome").value.trim();
        const email = ov.querySelector("#p-email").value.trim();
        if(!nome){ toast("Informe o nome", "A pessoa precisa de um nome."); return; }
        if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("E-mail inválido", "Confira o endereço digitado."); return; }
        const dados = {tipo, nome, foto, cargo: ov.querySelector("#p-cargo").value.trim(), email,
          info: ov.querySelector("#p-info").value.trim()};
        if(novo) state.people.push(touch(Object.assign({id:p.id}, dados)));
        else touch(Object.assign(personById(p.id), dados));
        if(await save()){
          closeModal(); renderAll();
          if(onDone) onDone(p.id);
          toast(novo ? "Pessoa cadastrada" : "Cadastro atualizado", nome);
        }
      };
    });
}
$$("[data-new-person]").forEach(b => b.addEventListener("click", () => personModal(null, b.dataset.newPerson)));
$("#juiz-filtro").addEventListener("click", e => {
  const b = e.target.closest("[data-jf]");
  if(b){ juizFiltro = b.dataset.jf; renderPeople(); }
});
document.addEventListener("click", async e => {
  const ed = e.target.closest("[data-person-edit]"), dl = e.target.closest("[data-person-del]");
  if(ed) personModal(personById(ed.dataset.personEdit));
  if(dl){
    const id = dl.dataset.personDel, p = personById(id);
    const n = state.meetings.filter(m => m.destinoTipo === "pessoa" && m.destinoValor === id).length;
    if(n){ toast("Pessoa em uso", "Há " + n + " reunião(ões) vinculada(s). Exclua ou altere essas reuniões primeiro."); return; }
    if(!await ask("Remover \"" + p.nome + "\" do cadastro?")) return;
    state.people = state.people.filter(x => x.id !== id);
    state.lixeira.push({id, upd:Date.now()});
    await save(); renderAll();
  }
});

/* ================= participantes ================= */
function renderParts(){
  $("#participantes").innerHTML = state.participants.length ? state.participants.map(p => {
    const n = state.meetings.filter(m => m.participantes.includes(p.id)).length;
    return '<div class="crud"><div class="info"><b>' + esc(p.nome) + "</b>" +
      "<span>" + esc(p.cargo || "sem cargo") + "</span>" +
      "<span>" + esc(p.email || "sem e-mail") + " · " + n + (n === 1 ? " reunião" : " reuniões") + "</span></div>" +
      '<div class="acts"><button class="btn ghost small" data-part-edit="' + p.id + '">Editar</button>' +
      '<button class="btn ghost small" data-part-del="' + p.id + '">Remover</button></div></div>';
  }).join("") : '<div class="empty"><strong>Nenhum participante cadastrado</strong>Os participantes das reuniões vêm deste cadastro.</div>';
}
function partModal(p, onDone){
  const novo = !p;
  p = p || {id:uid(), nome:"", cargo:"", email:""};
  openModal(
    "<h2>" + (novo ? "Cadastrar participante" : "Editar participante") + "</h2>" +
    '<div class="form" style="margin-top:18px">' +
      '<div class="field"><label for="pa-nome">Nome</label><input class="input" id="pa-nome" value="' + esc(p.nome) + '"></div>' +
      '<div class="field"><label for="pa-cargo">Cargo</label><input class="input" id="pa-cargo" value="' + esc(p.cargo) + '"></div>' +
      '<div class="field"><label for="pa-email">E-mail (usado para entrar no sistema)</label><input class="input" id="pa-email" type="email" value="' + esc(p.email) + '">' +
        '<p class="hint">Obrigatório: é com este endereço que a pessoa entra no GenMeet.</p></div>' +
      '<div class="form-actions"><button class="btn green" id="pa-save">' + (novo ? "Cadastrar" : "Salvar alterações") + "</button>" +
      '<button class="btn ghost" id="pa-cancel">Cancelar</button></div></div>',
    ov => {
      ov.querySelector("#pa-cancel").onclick = closeModal;
      ov.querySelector("#pa-save").onclick = async () => {
        const nome = ov.querySelector("#pa-nome").value.trim();
        const email = ov.querySelector("#pa-email").value.trim();
        if(!nome){ toast("Informe o nome", "O participante precisa de um nome."); return; }
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("E-mail obrigatório", "O e-mail é usado para entrar no sistema."); return; }
        const dados = {nome, cargo: ov.querySelector("#pa-cargo").value.trim(), email};
        if(novo) state.participants.push(touch(Object.assign({id:p.id}, dados)));
        else touch(Object.assign(partById(p.id), dados));
        if(await save()){
          closeModal(); renderAll();
          if(onDone) onDone(p.id);
          toast(novo ? "Participante cadastrado" : "Cadastro atualizado", nome);
        }
      };
    });
}
$("#new-part").addEventListener("click", () => partModal(null));
document.addEventListener("click", async e => {
  const ed = e.target.closest("[data-part-edit]"), dl = e.target.closest("[data-part-del]");
  if(ed) partModal(partById(ed.dataset.partEdit));
  if(dl){
    const id = dl.dataset.partDel, p = partById(id);
    const n = state.meetings.filter(m => m.participantes.includes(id)).length;
    if(n && !await ask(p.nome + " está em " + n + " reunião(ões). Remover mesmo assim?")) return;
    if(!n && !ask("Remover \"" + p.nome + "\" do cadastro?")) return;
    state.participants = state.participants.filter(x => x.id !== id);
    state.lixeira.push({id, upd:Date.now()});
    state.meetings.forEach(m => { if(m.participantes.includes(id)){ m.participantes = m.participantes.filter(x => x !== id); touch(m); } });
    await save(); renderAll();
  }
});

/* ================= avisos (1 h e 30 min) ================= */
async function checkReminders(){
  const now = Date.now();
  let changed = false;
  state.meetings.filter(m => m.status === "agendada").forEach(m => {
    const start = dt(m).getTime();
    reminders().forEach(r => {
      const at = start - r.min*60000, key = m.id + ":" + r.min;
      if(now >= at && now < start && !state.fired.includes(key)){
        state.fired.push(key); changed = true;
        dispararAviso(m, r.rot, false);
      }
    });
  });
  if(changed){ await save(); renderPainel(); }
}
if(window.Notification && Notification.permission === "default"){
  document.addEventListener("click", function once(){
    try{ Notification.requestPermission(); }catch(e){}
  }, {once:true});
}

/* ================= configurações ================= */
const LOGO_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true">' +
  '<g fill="none" stroke="var(--green)" stroke-width="3.2">' +
  '<ellipse cx="24" cy="24" rx="21" ry="9"/>' +
  '<ellipse cx="24" cy="24" rx="21" ry="9" transform="rotate(60 24 24)"/>' +
  '<ellipse cx="24" cy="24" rx="21" ry="9" transform="rotate(120 24 24)"/></g>' +
  '<circle cx="24" cy="5.8" r="4.4" fill="var(--teal)"/>' +
  '<circle cx="8.4" cy="33" r="3.8" fill="var(--blue)"/>' +
  '<circle cx="39.6" cy="33" r="3.8" fill="var(--green-light)"/></svg>';

function hex(h){ h = (h||"#000").replace("#",""); if(h.length===3) h = h.split("").map(c=>c+c).join("");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
function mix(a, b, t){
  const A = hex(a), B = hex(b);
  return "#" + A.map((v,i) => Math.round(v + (B[i]-v)*t).toString(16).padStart(2,"0")).join("");
}
const PALETAS = [
  {nome:"GenMeet",        cores:{bg:"#1327C6", navy:"#0A1240", blue:"#3350F0", green:"#8FE01B", teal:"#1596A8"}},
  {nome:"Azul noite",     cores:{bg:"#0A1836", navy:"#060F24", blue:"#2E6BE6", green:"#26D07C", teal:"#1596A8"}},
  {nome:"Verde floresta", cores:{bg:"#07341F", navy:"#042114", blue:"#1E7F8C", green:"#7BE034", teal:"#12A17A"}},
  {nome:"Roxo",           cores:{bg:"#2B1470", navy:"#170A3D", blue:"#6B4CF0", green:"#A8E01B", teal:"#2F8FA8"}},
  {nome:"Vinho",          cores:{bg:"#3A0A2A", navy:"#22061A", blue:"#B0356F", green:"#E0A31B", teal:"#8C1F5A"}},
  {nome:"Grafite",        cores:{bg:"#1B1F2A", navy:"#12151D", blue:"#4A6CF0", green:"#8FE01B", teal:"#3E8E9E"}}
];
let temaPreview = null;
/* cada pessoa vê o sistema com as cores dela; sem tema pessoal, valem as cores da equipe */
function temaAtivo(){
  const base = cfg().cores;
  if(temaPreview) return Object.assign({}, base, temaPreview);
  return base;
}
function applyConfig(){
  const c = cfg(), co = temaAtivo(), r = document.documentElement.style;
  r.setProperty("--bg", co.bg);
  r.setProperty("--navy", co.navy);
  r.setProperty("--surface", co.navy);
  r.setProperty("--navy-2", mix(co.navy, "#000000", .35));
  r.setProperty("--raised", mix(co.navy, co.blue, .28));
  r.setProperty("--line", mix(co.navy, co.blue, .55));
  r.setProperty("--line-soft", mix(co.navy, co.blue, .3));
  r.setProperty("--blue", co.blue);
  r.setProperty("--blue-light", mix(co.blue, "#FFFFFF", .45));
  r.setProperty("--blue-deep", mix(co.blue, "#000000", .35));
  r.setProperty("--green", co.green);
  r.setProperty("--green-light", mix(co.green, "#FFFFFF", .35));
  r.setProperty("--green-deep", mix(co.green, "#000000", .3));
  r.setProperty("--teal", co.teal);
  r.setProperty("--text", mix(co.blue, "#FFFFFF", .74));
  r.setProperty("--dim", mix(co.blue, "#FFFFFF", .52));
  r.setProperty("--atom", 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 200 200\'%3E%3Cg fill=\'none\' stroke=\'%23' +
    co.green.replace("#","") + '\' stroke-width=\'9\'%3E%3Cellipse cx=\'100\' cy=\'100\' rx=\'88\' ry=\'38\'/%3E%3Cellipse cx=\'100\' cy=\'100\' rx=\'88\' ry=\'38\' transform=\'rotate(60 100 100)\'/%3E%3Cellipse cx=\'100\' cy=\'100\' rx=\'88\' ry=\'38\' transform=\'rotate(120 100 100)\'/%3E%3C/g%3E%3C/svg%3E")');

  const nome = c.nome || "GenMeet";
  const m = nome.match(/^(.*?)(meet)$/i);
  const marca = m ? esc(m[1]) + "<span>" + esc(m[2]) + "</span>" : esc(nome);
  const marcaHtml = (c.logo ? '<img src="' + c.logo + '" alt="">' : LOGO_SVG) +
    '<span class="wordmark">' + marca + "</span>";
  const contaBtn=document.querySelector('#nav button[data-v="conta"]'); if(contaBtn) contaBtn.style.display="none";
  const contaView=document.getElementById("v-conta"); if(contaView) contaView.style.display="none";
  $$(".brand, .mobile-brand").forEach(el => el.innerHTML = marcaHtml);
  document.title = nome + " — agendamento, comunicação e registro de reuniões";

  $$("#nav button[data-v]").forEach(b => {
    const k = b.dataset.v;
    if(k === "painel" || k === "config") return;
    b.style.display = c.menu[k] === false ? "none" : "";
  });
  const foot = document.querySelector(".rail-foot");
  if(foot) foot.textContent = "Avisos automáticos " + reminders().map(x => x.rot.replace(" antes","")).join(" e ") + " antes de cada reunião.";
}

let tmpLembretes = [];
function renderConfig(){
  const c = cfg();
  tmpLembretes = (c.lembretes || []).slice();
  const chk = (id, on, label) => '<div class="cfg-row"><input type="checkbox" id="' + id + '" ' + (on ? "checked" : "") +
    '><label for="' + id + '">' + label + "</label></div>";
  const cor = (id, val, label) => '<div class="cfg-row"><label for="' + id + '">' + label +
    '</label><input type="color" id="' + id + '" value="' + val + '"></div>';

  $("#cfg-body").innerHTML =
    '<div class="cfg-grid">' +
      '<div class="cfg-card"><h3>Identidade</h3><p class="hint">Nome e marca do sistema.</p>' +
        '<div class="field"><label for="c-nome">Nome do sistema</label><input class="input" id="c-nome" value="' + esc(c.nome) + '"></div>' +
        '<div class="field" style="margin-top:12px"><label for="c-logo">Logo (substitui o átomo)</label>' +
        '<input type="file" class="input" id="c-logo" accept="image/*" style="padding:8px"></div>' +
        '<div class="cfg-actions"><button class="btn ghost small" id="c-logo-rm">Voltar ao átomo</button></div></div>' +

      '<div class="cfg-card"><h3>Cores da equipe</h3><p class="hint">Padrão visual de quem ainda não escolheu cores próprias. ' +
        "As cores são definidas nas Configurações do GenMeet.</p>" +
        cor("c-bg", c.cores.bg, "Fundo (azul principal)") +
        cor("c-navy", c.cores.navy, "Painéis e cartões") +
        cor("c-blue", c.cores.blue, "Azul de ação") +
        cor("c-green", c.cores.green, "Verde de destaque") +
        cor("c-teal", c.cores.teal, "Cor de apoio") +
        '<div class="cfg-actions"><button class="btn ghost small" id="c-cores-reset">Restaurar padrão</button></div></div>' +

      '<div class="cfg-card"><h3>Avisos</h3><p class="hint">Quantos minutos antes cada aviso dispara.</p>' +
        '<div id="c-lembretes"></div>' +
        '<div class="cfg-actions"><button class="btn ghost small" id="c-lem-add">+ Adicionar aviso</button></div>' +
        '<div style="margin-top:14px">' + chk("c-notif", c.notificacoes, "Mostrar notificação do navegador") + "</div></div>" +

      '<div class="cfg-card"><h3>Regras</h3><p class="hint">Validações do formulário de reunião.</p>' +
        chk("c-r1", c.regras.participantesObrig, "Exigir ao menos um participante") +
        chk("c-r2", c.regras.bloquearPassado, "Bloquear data anterior a hoje") +
        chk("c-r3", c.regras.confirmarExclusao, "Pedir confirmação ao excluir ou cancelar") +
        '<p class="hint" style="margin-top:10px">A regra de destino único (pessoa ou equipe) é fixa e não pode ser desligada.</p></div>' +

      '<div class="cfg-card"><h3>Rótulos dos tipos</h3><p class="hint">Renomeie como cada tipo aparece no sistema.</p>' +
        TIPOS.map(t => '<div class="field" style="margin-bottom:10px"><label for="c-rot-' + t.k + '">' + t.icon + " " + t.label +
          '</label><input class="input" id="c-rot-' + t.k + '" value="' + esc(tipoLabel(t.k)) + '"></div>').join("") + "</div>" +

      '<div class="cfg-card"><h3>Menu</h3><p class="hint">Escolha quais áreas aparecem na navegação.</p>' +
        Object.keys(DEFAULT_CFG.menu).map(k => chk("c-menu-" + k, c.menu[k] !== false,
          ({nova:"Nova reunião",reunioes:"Reuniões",agenda:"Agenda",equipes:"Equipes",
            especialistas:"Especialistas",juizes:"Juízes",participantes:"Participantes"})[k])).join("") + "</div>" +

    "</div>";

  drawLembretes();
  bindConfig();
}
function drawLembretes(){
  $("#c-lembretes").innerHTML = tmpLembretes.map((v,i) =>
    '<div class="cfg-row"><input class="input mini" type="number" min="1" max="10080" value="' + v + '" data-lem="' + i + '">' +
    '<label>minutos antes</label>' +
    '<button class="btn ghost small" data-lem-rm="' + i + '">remover</button></div>').join("") ||
    '<p class="hint">Nenhum aviso configurado.</p>';
}
function bindConfig(){
  const body = $("#cfg-body");
  ["bg","navy","blue","green","teal"].forEach(k => {
    const el = $("#c-" + k);
    el.oninput = () => { cfg().cores[k] = el.value; applyConfig(); };
  });
  $("#c-cores-reset").onclick = () => { state.cfg.cores = clone(DEFAULT_CFG.cores); applyConfig(); renderConfig(); };
  $("#c-logo").onchange = async ev => {
    const f = ev.target.files[0]; if(!f) return;
    state.cfg.logo = await shrink(await readFile(f), 160, .9);
    applyConfig();
  };
  $("#c-logo-rm").onclick = () => { state.cfg.logo = ""; applyConfig(); };
  $("#c-lem-add").onclick = () => { tmpLembretes.push(15); drawLembretes(); };
  body.addEventListener("click", e => {
    const rm = e.target.closest("[data-lem-rm]");
    if(rm){ tmpLembretes.splice(+rm.dataset.lemRm, 1); drawLembretes(); }
  });
  body.addEventListener("input", e => {
    const i = e.target.closest("[data-lem]");
    if(i) tmpLembretes[+i.dataset.lem] = Math.max(1, parseInt(i.value || "1", 10));
  });
}
async function salvarConfig(){
  const c = state.cfg;
  c.nome = $("#c-nome").value.trim() || "GenMeet";
  c.lembretes = tmpLembretes.filter(n => n > 0).sort((a,b) => b-a);
  if(!c.lembretes.length) c.lembretes = [60,30];
  c.notificacoes = $("#c-notif").checked;
  c.regras = {participantesObrig: $("#c-r1").checked, bloquearPassado: $("#c-r2").checked, confirmarExclusao: $("#c-r3").checked};
  TIPOS.forEach(t => { c.rotulos[t.k] = $("#c-rot-" + t.k).value.trim() || t.label; });
  Object.keys(DEFAULT_CFG.menu).forEach(k => { c.menu[k] = $("#c-menu-" + k).checked; });
  if(await save()){
    applyConfig(); renderAll(); renderConfig();
    toast("Configurações salvas", "As mudanças já valem em todo o sistema.");
  }
}
$("#cfg-save").addEventListener("click", salvarConfig);

/* ================= acesso sem login ================= */
// O GenMeet atual não possui contas nem autenticação. Este objeto existe apenas
// para compatibilidade com trechos antigos da interface que consultavam sessao.
const sessao = {id:null,nome:"",email:"",role:"adm_principal"};
function carregarUsuarios(){}
function sair(){}

/* ================= sincronização ================= */
let ultimoSync = null, sincronizando = false;
async function sincronizar(silencioso){
  if(sincronizando) return false;
  sincronizando=true;
  try{
    await carregarDadosSupabase();
    ultimoSync=new Date().toTimeString().slice(0,5);
    applyConfig(); renderAll();
    if(!silencioso) toast('Sincronizado','Dados atualizados a partir do Supabase.');
    return true;
  }catch(e){
    if(!silencioso) toast('Falha na sincronização',e.message||'Não foi possível atualizar os dados.');
    return false;
  }finally{ sincronizando=false; }
}

/* ================= diagnóstico ================= */
window.addEventListener("error", e => {
  try{ toast("Erro no sistema", (e.message || "falha desconhecida") + (e.lineno ? " (linha " + e.lineno + ")" : "")); }catch(_){}
});
window.addEventListener("unhandledrejection", e => {
  try{ toast("Erro no sistema", (e.reason && e.reason.message) ? e.reason.message : String(e.reason)); }catch(_){}
});

/* ================= boot ================= */
function comTimeout(promise, ms, mensagem){
  return Promise.race([promise, new Promise((_,reject)=>setTimeout(()=>reject(new Error(mensagem||"Tempo limite excedido.")),ms))]);
}
function renderAll(){
  renderPickers(); renderChips(); fillQuem();
  renderPainel(); renderList(); renderCal(); renderTeams(); renderPeople(); renderParts();
}
(async function boot(){
  try{
    const conectado=await comTimeout(verificarSupabase(),8000,"Tempo limite ao conectar ao Supabase.");
    if(conectado){
      try{ await comTimeout(carregarDadosSupabase(),10000,"Tempo limite ao carregar os dados do Supabase."); }
      catch(e){ setSupabaseStatus("err","Supabase offline"); toast("Supabase demorou para responder","O GenMeet continua aberto. Use 'Tentar novamente' quando a conexão voltar."); }
    }
  }catch(e){
    setSupabaseStatus("err","Supabase offline");
  }
  applyConfig();
  const f=document.getElementById("f-data"); if(f) f.min=iso(new Date());
  fillCriadores();
  renderAll();
  setInterval(async()=>{ if(!dbLoaded){ try{const ok=await comTimeout(carregarDadosSupabase(),8000,"Tempo limite."); if(ok){applyConfig();fillCriadores();renderAll();}}catch(e){} } },15000);
  setInterval(checkReminders,15000);
  setInterval(()=>{ if(document.getElementById("v-painel")?.classList.contains("on")) renderPainel(); },30000);
  checkReminders();
})();
})();

