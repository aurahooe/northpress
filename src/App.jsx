import { useEffect, useMemo, useState } from "react";
import { formatHourLabel, hourKey, msUntilNextHour, pickByHour, supabase } from "./lib";

const TABS = ["desk", "write", "mine", "account"];

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("desk");
  const [publicPieces, setPublicPieces] = useState([]);
  const [mine, setMine] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState("");
  const key = hourKey(now);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    loadPublic();
  }, [key]);

  useEffect(() => {
    if (session?.user) loadMine(session.user.id);
    else {
      setMine([]);
      setProfile(null);
    }
  }, [session]);

  async function loadPublic() {
    const { data } = await supabase
      .from("northpress_pieces")
      .select("*, northpress_profiles(handle, display_name)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(80);
    const list = data ?? [];
    setPublicPieces(list);

    const { data: hourRow } = await supabase
      .from("northpress_hours")
      .select("piece_id")
      .eq("hour_key", key)
      .maybeSingle();

    let chosen = hourRow
      ? list.find((p) => p.id === hourRow.piece_id)
      : pickByHour(list, key);

    if (!hourRow && chosen && session?.user) {
      await supabase.from("northpress_hours").insert({ piece_id: chosen.id, hour_key: key });
    }
    setFeatured(chosen ?? null);
  }

  async function loadMine(uid) {
    const [{ data: p }, { data: notes }] = await Promise.all([
      supabase.from("northpress_profiles").select("*").eq("id", uid).maybeSingle(),
      supabase
        .from("northpress_pieces")
        .select("*")
        .eq("author_id", uid)
        .order("created_at", { ascending: false }),
    ]);
    if (!p) {
      const handle = (session?.user?.email || "desk").split("@")[0] + "-" + uid.slice(0, 5);
      const { data: created } = await supabase
        .from("northpress_profiles")
        .insert({ id: uid, handle, display_name: handle })
        .select()
        .single();
      setProfile(created);
    } else setProfile(p);
    setMine(notes ?? []);
  }

  const countdown = useMemo(() => {
    const ms = msUntilNextHour();
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [now]);

  return (
    <div className="shell">
      <header className="mast">
        <div>
          <p className="kicker">Est. this hour · public desk</p>
          <h1 className="wordmark">
            North <em>Press</em>
          </h1>
        </div>
        <div className="clockbox">
          <div className="clock">
            {now.toUTCString().slice(17, 25)} UTC
            <small>next turn in {countdown} · {formatHourLabel(key)}</small>
          </div>
        </div>
      </header>

      <nav className="nav">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        {session && (
          <button onClick={() => supabase.auth.signOut()}>sign out</button>
        )}
      </nav>

      {tab === "desk" && (
        <div className="layout">
          <section className="feature">
            <p className="kicker">This hour</p>
            {featured ? (
              <>
                <p className="meta">
                  {featured.northpress_profiles?.display_name || "anon"} · @{featured.northpress_profiles?.handle}
                </p>
                <h2>{featured.title || "Untitled slip"}</h2>
                <div className="bodycopy">{featured.body}</div>
              </>
            ) : (
              <>
                <h2>The desk is empty.</h2>
                <p className="bodycopy">
                  Sign in, write something, and mark it public. At the top of the next hour it can sit here.
                </p>
              </>
            )}
          </section>
          <aside className="rail">
            <h3>On the board</h3>
            {publicPieces.length === 0 && <p className="meta">No public slips yet.</p>}
            {publicPieces.map((p) => (
              <article key={p.id} className="card" onClick={() => setFeatured(p)}>
                <p className="meta">@{p.northpress_profiles?.handle}</p>
                <h4>{p.title || "Untitled"}</h4>
                <p>{p.body}</p>
              </article>
            ))}
          </aside>
        </div>
      )}

      {tab === "write" && (
        <Write
          session={session}
          profile={profile}
          onDone={() => {
            setTab("mine");
            if (session?.user) loadMine(session.user.id);
            loadPublic();
          }}
        />
      )}

      {tab === "mine" && (
        <section>
          {!session && <p>Sign in from Account to keep a private drawer.</p>}
          {mine.map((p) => (
            <article key={p.id} className={"card " + (p.is_public ? "" : "private")}>
              <p className="meta">{new Date(p.created_at).toUTCString()}</p>
              <h4>{p.title || "Untitled"}</h4>
              <p>{p.body}</p>
            </article>
          ))}
        </section>
      )}

      {tab === "account" && (
        <Account
          session={session}
          profile={profile}
          onProfile={async (patch) => {
            if (!session?.user) return;
            const { error } = await supabase
              .from("northpress_profiles")
              .update(patch)
              .eq("id", session.user.id);
            if (!error) {
              setProfile({ ...profile, ...patch });
              setNotice("Saved.");
            } else setNotice(error.message);
          }}
          notice={notice}
        />
      )}

      <footer className="foot">Paper changes on the hour. Private writing stays in the drawer.</footer>
    </div>
  );
}

function Write({ session, profile, onDone }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!session?.user || !profile) {
      setErr("Sign in first.");
      return;
    }
    if (!body.trim()) {
      setErr("Write a few lines.");
      return;
    }
    const { error } = await supabase.from("northpress_pieces").insert({
      author_id: session.user.id,
      title: title.trim(),
      body: body.trim(),
      is_public: isPublic,
    });
    if (error) setErr(error.message);
    else {
      setTitle("");
      setBody("");
      onDone();
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <p className="kicker">New slip</p>
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
      <label>Body</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What belongs on paper this hour?" />
      <label className="check">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Mark public — anyone can read it, and it can be featured
      </label>
      <div className="row">
        <button className="btn" type="submit">File it</button>
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

function Account({ session, profile, onProfile, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("in");
  const [err, setErr] = useState("");
  const [name, setName] = useState(profile?.display_name || "");
  const [handle, setHandle] = useState(profile?.handle || "");
  const [bio, setBio] = useState(profile?.bio || "");

  useEffect(() => {
    setName(profile?.display_name || "");
    setHandle(profile?.handle || "");
    setBio(profile?.bio || "");
  }, [profile]);

  async function auth(e) {
    e.preventDefault();
    setErr("");
    const fn = mode === "up" ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { error } = await fn({ email, password });
    if (error) setErr(error.message);
  }

  if (!session) {
    return (
      <form className="panel" onSubmit={auth}>
        <p className="kicker">{mode === "up" ? "Open a drawer" : "Return to the desk"}</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <div className="row">
          <button className="btn" type="submit">{mode === "up" ? "Create account" : "Sign in"}</button>
          <button className="btn ghost" type="button" onClick={() => setMode(mode === "up" ? "in" : "up")}>
            {mode === "up" ? "I already have one" : "I need an account"}
          </button>
        </div>
        {err && <p className="err">{err}</p>}
      </form>
    );
  }

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onProfile({ display_name: name, handle, bio });
      }}
    >
      <p className="kicker">Masthead</p>
      <label>Display name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label>Handle</label>
      <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
      <label>Bio</label>
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
      <div className="row">
        <button className="btn" type="submit">Save</button>
      </div>
      {notice && <p className="ok">{notice}</p>}
    </form>
  );
}
