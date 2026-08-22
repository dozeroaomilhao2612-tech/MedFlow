
(() => {
  const configured = () =>
    window.MEDFLOW_SUPABASE_URL &&
    window.MEDFLOW_SUPABASE_ANON_KEY &&
    !window.MEDFLOW_SUPABASE_URL.includes("COLE_") &&
    !window.MEDFLOW_SUPABASE_ANON_KEY.includes("COLE_");

  let sb = null;
  let currentUser = null;
  let syncing = false;

  function el(id){ return document.getElementById(id); }
  function msg(text, ok=false){
    const m=el("authMessage"); if(!m)return;
    m.textContent=text||""; m.style.color=ok?"#59dda0":"#ffb84d";
  }
  function showLogin(){
    el("loginTab")?.classList.add("active"); el("signupTab")?.classList.remove("active");
    el("loginForm")?.classList.remove("hidden"); el("signupForm")?.classList.add("hidden");
    msg("");
  }
  function showSignup(){
    el("signupTab")?.classList.add("active"); el("loginTab")?.classList.remove("active");
    el("signupForm")?.classList.remove("hidden"); el("loginForm")?.classList.add("hidden");
    msg("");
  }

  function localSnapshot(){
    const keys=["medflowV2Smart","medflowData","medflowPerformance","medflowAdvancedSubjects","medflowTasks","medflowSubjects"];
    const data={};
    for(const k of keys){
      const v=localStorage.getItem(k);
      if(v!==null){ try{ data[k]=JSON.parse(v); }catch{ data[k]=v; } }
    }
    return data;
  }

  function applySnapshot(data){
    if(!data || typeof data!=="object")return;
    for(const [k,v] of Object.entries(data)){
      localStorage.setItem(k, typeof v==="string"?v:JSON.stringify(v));
    }
  }

  async function saveCloud(){
    if(!sb || !currentUser || syncing)return;
    syncing=true;
    try{
      await sb.from("user_app_state").upsert({
        user_id:currentUser.id,
        state:localSnapshot(),
        updated_at:new Date().toISOString()
      }, { onConflict:"user_id" });
    }finally{ syncing=false; }
  }

  async function loadCloud(){
    if(!sb || !currentUser)return;
    const {data,error}=await sb.from("user_app_state").select("state").eq("user_id",currentUser.id).maybeSingle();
    if(error){ console.warn("MEDFLOW cloud load:",error.message); return; }
    if(data?.state){
      applySnapshot(data.state);
      sessionStorage.setItem("medflow_cloud_loaded","1");
    }else{
      await saveCloud();
    }
  }

  async function loadProfile(){
    if(!sb || !currentUser)return null;
    const {data}=await sb.from("profiles").select("name,period").eq("id",currentUser.id).maybeSingle();
    return data||null;
  }

  async function renderAccount(){
    if(!currentUser)return;
    const p=await loadProfile();
    const name=p?.name || currentUser.user_metadata?.name || "Estudante";
    el("accountName").textContent=name;
    el("accountEmail").textContent=currentUser.email||"";
    el("accountPeriod").textContent=p?.period ? `${p.period}º período` : "";
    el("accountAvatar").textContent=(name.trim()[0]||"M").toUpperCase();
  }

  async function enterApp(session){
    currentUser=session?.user||null;
    if(!currentUser){ el("authGate")?.classList.remove("hidden"); return; }
    await loadCloud();
    el("authGate")?.classList.add("hidden");
    await renderAccount();
    window.dispatchEvent(new CustomEvent("medflow:authenticated",{detail:{user:currentUser}}));
  }

  async function init(){
    if(!configured() || !window.supabase){
      el("setupWarning")?.classList.remove("hidden");
      return;
    }
    sb=window.supabase.createClient(window.MEDFLOW_SUPABASE_URL,window.MEDFLOW_SUPABASE_ANON_KEY);
    window.medflowSupabase=sb;

    const {data:{session}}=await sb.auth.getSession();
    if(session) await enterApp(session);
    else el("authGate")?.classList.remove("hidden");

    sb.auth.onAuthStateChange(async(_event,session)=>{
      if(session) await enterApp(session);
      else{
        currentUser=null;
        el("authGate")?.classList.remove("hidden");
      }
    });
  }

  document.addEventListener("DOMContentLoaded",()=>{
    el("loginTab")?.addEventListener("click",showLogin);
    el("signupTab")?.addEventListener("click",showSignup);

    el("loginForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!sb)return msg("Configure o Supabase primeiro.");
      msg("Entrando...");
      const {error}=await sb.auth.signInWithPassword({
        email:el("loginEmail").value.trim(),
        password:el("loginPassword").value
      });
      if(error) msg(error.message); else msg("Login realizado.",true);
    });

    el("signupForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!sb)return msg("Configure o Supabase primeiro.");
      const name=el("signupName").value.trim(), email=el("signupEmail").value.trim(),
            password=el("signupPassword").value, period=Number(el("signupPeriod").value);
      msg("Criando conta...");
      const {data,error}=await sb.auth.signUp({
        email,password,
        options:{data:{name,period}}
      });
      if(error)return msg(error.message);
      if(data.user){
        await sb.from("profiles").upsert({id:data.user.id,name,period});
      }
      msg(data.session ? "Conta criada. Bem-vindo ao MEDFLOW!" : "Conta criada. Confirme seu e-mail para entrar.",true);
    });

    el("forgotPasswordBtn")?.addEventListener("click",async()=>{
      if(!sb)return msg("Configure o Supabase primeiro.");
      const email=el("loginEmail").value.trim();
      if(!email)return msg("Digite seu e-mail primeiro.");
      const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
      msg(error?error.message:"Enviamos o link de recuperação para seu e-mail.",!error);
    });

    el("logoutBtn")?.addEventListener("click",async()=>{
      await saveCloud();
      await sb?.auth.signOut();
      el("accountModal")?.classList.add("hidden");
    });
    el("accountBtn")?.addEventListener("click",async()=>{
      await renderAccount();
      el("accountModal")?.classList.remove("hidden");
    });
    el("closeAccountBtn")?.addEventListener("click",()=>el("accountModal")?.classList.add("hidden"));
    el("syncNowBtn")?.addEventListener("click",async()=>{
      await saveCloud();
      const b=el("syncNowBtn"); if(b){b.textContent="Sincronizado ✓";setTimeout(()=>b.textContent="Sincronizar agora",1300);}
    });

    // Sincronização leve ao alterar dados e ao sair da página.
    const originalSetItem=localStorage.setItem.bind(localStorage);
    let timer=null;
    localStorage.setItem=function(k,v){
      originalSetItem(k,v);
      clearTimeout(timer);
      timer=setTimeout(()=>saveCloud(),900);
    };
    window.addEventListener("pagehide",()=>{ if(currentUser) saveCloud(); });

    init();
  });
})();
