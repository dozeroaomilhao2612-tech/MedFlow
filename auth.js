
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
    const m=el("authMessage");
    if(!m) return;

    const raw=String(text||"");
    const friendly = (!ok && /load failed|failed to fetch|network|abort/i.test(raw))
      ? "Falha de conexão com o servidor. O MEDFLOW tentou novamente automaticamente. Verifique sua internet e tente mais uma vez."
      : raw;

    m.textContent=friendly;
    m.style.color=ok ? "#59dda0" : "#ffb84d";
  }

  function showLogin(){
    el("loginTab")?.classList.add("active");
    el("signupTab")?.classList.remove("active");
    el("loginForm")?.classList.remove("hidden");
    el("signupForm")?.classList.add("hidden");
    msg("");
  }

  function showSignup(){
    el("signupTab")?.classList.add("active");
    el("loginTab")?.classList.remove("active");
    el("signupForm")?.classList.remove("hidden");
    el("loginForm")?.classList.add("hidden");
    msg("");
  }

  function localSnapshot(){
    const keys=[
      "medflowV2Smart",
      "medflowData",
      "medflowPerformance",
      "medflowAdvancedSubjects",
      "medflowTasks",
      "medflowSubjects"
    ];
    const data={};

    for(const k of keys){
      const v=localStorage.getItem(k);
      if(v!==null){
        try{ data[k]=JSON.parse(v); }
        catch{ data[k]=v; }
      }
    }
    return data;
  }

  function applySnapshot(data){
    if(!data || typeof data!=="object") return;

    for(const [k,v] of Object.entries(data)){
      localStorage.setItem(
        k,
        typeof v==="string" ? v : JSON.stringify(v)
      );
    }
  }

  async function fetchWithRetry(input, init={}, retries=3, timeoutMs=12000){
    let lastError;

    for(let attempt=0; attempt<retries; attempt++){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(), timeoutMs);

      try{
        const response=await fetch(input,{
          ...init,
          signal:controller.signal
        });
        clearTimeout(timeout);
        return response;
      }catch(error){
        clearTimeout(timeout);
        lastError=error;

        if(attempt<retries-1){
          await new Promise(resolve =>
            setTimeout(resolve, 700*(attempt+1))
          );
        }
      }
    }

    throw lastError;
  }

  async function saveCloud(){
    if(!sb || !currentUser || syncing) return;

    syncing=true;
    try{
      const {error}=await sb.from("user_app_state").upsert({
        user_id:currentUser.id,
        state:localSnapshot(),
        updated_at:new Date().toISOString()
      },{onConflict:"user_id"});

      if(error) console.warn("MEDFLOW cloud save:",error.message);
    }catch(error){
      console.warn("MEDFLOW cloud save:",error);
    }finally{
      syncing=false;
    }
  }

  async function loadCloud(){
    if(!sb || !currentUser) return;

    try{
      const {data,error}=await sb
        .from("user_app_state")
        .select("state")
        .eq("user_id",currentUser.id)
        .maybeSingle();

      if(error){
        console.warn("MEDFLOW cloud load:",error.message);
        return;
      }

      if(data?.state){
        applySnapshot(data.state);
        sessionStorage.setItem("medflow_cloud_loaded","1");
      }else{
        await saveCloud();
      }
    }catch(error){
      console.warn("MEDFLOW cloud load:",error);
    }
  }

  async function loadProfile(){
    if(!sb || !currentUser) return null;

    try{
      const {data}=await sb
        .from("profiles")
        .select("name,period")
        .eq("id",currentUser.id)
        .maybeSingle();

      return data||null;
    }catch{
      return null;
    }
  }

  async function renderAccount(){
    if(!currentUser) return;

    const p=await loadProfile();
    const name=p?.name || currentUser.user_metadata?.name || "Estudante";

    if(el("accountName")) el("accountName").textContent=name;
    if(el("accountEmail")) el("accountEmail").textContent=currentUser.email||"";
    if(el("accountPeriod")) el("accountPeriod").textContent=p?.period ? `${p.period}º período` : "";
    if(el("accountAvatar")) el("accountAvatar").textContent=(name.trim()[0]||"M").toUpperCase();
  }

  async function enterApp(session){
    currentUser=session?.user||null;

    if(!currentUser){
      el("authGate")?.classList.remove("hidden");
      return;
    }

    await loadCloud();
    el("authGate")?.classList.add("hidden");
    await renderAccount();

    window.dispatchEvent(
      new CustomEvent("medflow:authenticated",{
        detail:{user:currentUser}
      })
    );
  }

  async function init(){
    if(!configured() || !window.supabase){
      el("setupWarning")?.classList.remove("hidden");
      return;
    }

    sb=window.supabase.createClient(
      window.MEDFLOW_SUPABASE_URL,
      window.MEDFLOW_SUPABASE_ANON_KEY,
      {
        global:{fetch:fetchWithRetry},
        auth:{
          persistSession:true,
          autoRefreshToken:true,
          detectSessionInUrl:true
        }
      }
    );

    window.medflowSupabase=sb;

    try{
      const {data:{session},error}=await sb.auth.getSession();
      if(error) console.warn("MEDFLOW session:",error.message);

      if(session) await enterApp(session);
      else el("authGate")?.classList.remove("hidden");
    }catch(error){
      console.warn("MEDFLOW init:",error);
      el("authGate")?.classList.remove("hidden");
    }

    sb.auth.onAuthStateChange(async(_event,session)=>{
      if(session){
        await enterApp(session);
      }else{
        currentUser=null;
        el("authGate")?.classList.remove("hidden");
      }
    });

    // Diagnóstico silencioso de conectividade.
    try{
      const healthUrl=window.MEDFLOW_SUPABASE_URL+"/auth/v1/health";
      const r=await fetchWithRetry(
        healthUrl,
        {headers:{apikey:window.MEDFLOW_SUPABASE_ANON_KEY}},
        2,
        8000
      );
      console.info("MEDFLOW Supabase health:",r.status);
    }catch(error){
      console.warn("MEDFLOW Supabase indisponível:",error);
    }
  }

  document.addEventListener("DOMContentLoaded",()=>{
    el("loginTab")?.addEventListener("click",showLogin);
    el("signupTab")?.addEventListener("click",showSignup);

    el("loginForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!sb) return msg("Configure o Supabase primeiro.");

      const form=e.currentTarget;
      const button=form.querySelector('button[type="submit"]');
      if(button?.disabled) return;

      if(button){
        button.disabled=true;
        button.textContent="Entrando...";
      }

      msg("Conectando...");

      try{
        const {error}=await sb.auth.signInWithPassword({
          email:el("loginEmail").value.trim(),
          password:el("loginPassword").value
        });

        if(error) msg(error.message);
        else msg("Login realizado.",true);
      }catch(error){
        console.error("MEDFLOW login:",error);
        msg(error?.message || "Falha de conexão ao entrar.");
      }finally{
        if(button){
          button.disabled=false;
          button.textContent="Entrar no MEDFLOW";
        }
      }
    });

    el("signupForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!sb) return msg("Configure o Supabase primeiro.");

      const form=e.currentTarget;
      const button=form.querySelector('button[type="submit"]');
      if(button?.disabled) return;

      const name=el("signupName").value.trim();
      const email=el("signupEmail").value.trim();
      const password=el("signupPassword").value;
      const period=Number(el("signupPeriod").value);

      if(!name) return msg("Digite seu nome.");
      if(!email) return msg("Digite seu e-mail.");
      if(password.length<6) return msg("A senha precisa ter pelo menos 6 caracteres.");

      if(button){
        button.disabled=true;
        button.textContent="Criando conta...";
      }

      msg("Conectando ao MEDFLOW...");

      try{
        const {data,error}=await sb.auth.signUp({
          email,
          password,
          options:{data:{name,period}}
        });

        if(error) return msg(error.message);

        if(data.user){
          try{
            const {error:profileError}=await sb
              .from("profiles")
              .upsert({
                id:data.user.id,
                name,
                period
              });

            if(profileError){
              console.warn("MEDFLOW profile:",profileError.message);
            }
          }catch(error){
            console.warn("MEDFLOW profile:",error);
          }
        }

        msg(
          data.session
            ? "Conta criada. Bem-vindo ao MEDFLOW!"
            : "Conta criada. Confirme seu e-mail para entrar.",
          true
        );
      }catch(error){
        console.error("MEDFLOW signup:",error);
        msg(error?.message || "Falha de conexão ao criar a conta.");
      }finally{
        if(button){
          button.disabled=false;
          button.textContent="Criar minha conta";
        }
      }
    });

    el("forgotPasswordBtn")?.addEventListener("click",async()=>{
      if(!sb) return msg("Configure o Supabase primeiro.");

      const email=el("loginEmail").value.trim();
      if(!email) return msg("Digite seu e-mail primeiro.");

      try{
        const {error}=await sb.auth.resetPasswordForEmail(
          email,
          {redirectTo:location.origin+location.pathname}
        );

        msg(
          error ? error.message : "Enviamos o link de recuperação para seu e-mail.",
          !error
        );
      }catch(error){
        msg(error?.message || "Falha de conexão ao solicitar recuperação.");
      }
    });

    el("logoutBtn")?.addEventListener("click",async()=>{
      await saveCloud();

      try{
        await sb?.auth.signOut();
      }catch(error){
        console.warn("MEDFLOW logout:",error);
      }

      el("accountModal")?.classList.add("hidden");
    });

    el("accountBtn")?.addEventListener("click",async()=>{
      await renderAccount();
      el("accountModal")?.classList.remove("hidden");
    });

    el("closeAccountBtn")?.addEventListener(
      "click",
      ()=>el("accountModal")?.classList.add("hidden")
    );

    el("syncNowBtn")?.addEventListener("click",async()=>{
      await saveCloud();

      const b=el("syncNowBtn");
      if(b){
        b.textContent="Sincronizado ✓";
        setTimeout(()=>b.textContent="Sincronizar agora",1300);
      }
    });

    const originalSetItem=localStorage.setItem.bind(localStorage);
    let timer=null;

    localStorage.setItem=function(k,v){
      originalSetItem(k,v);
      clearTimeout(timer);
      timer=setTimeout(()=>saveCloud(),900);
    };

    window.addEventListener("pagehide",()=>{
      if(currentUser) saveCloud();
    });

    init();
  });
})();
