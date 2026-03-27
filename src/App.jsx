import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  LogOut,
  IndianRupee,
  Lock,
  Milestone,
  Moon,
  Sparkles,
  ShieldCheck,
  Sun,
  UploadCloud,
  User,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildInsights,
  detectHiddenSubscriptions,
  demoTransactions,
  detectSubscriptions,
  parseFile,
  suggestAlternative,
} from "./utils/subscriptionUtils";
import { supabase } from "./lib/supabaseClient";
import { getLatestUserDataset, saveUserDataset } from "./lib/userDataService";

const CHART_COLORS = ["#7c3aed", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444", "#6366f1"];

function currency(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function priorityWeight(priority) {
  if (priority === "High") return 3;
  if (priority === "Medium") return 2;
  return 1;
}

function isUsersDataTableMissing(error) {
  const msg = `${error?.message || ""}`.toLowerCase();
  return msg.includes("could not find the table") && msg.includes("users_data");
}

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [cancelled, setCancelled] = useState([]);
  const [yearlyProjection, setYearlyProjection] = useState(false);
  const [tableSort, setTableSort] = useState("cost");
  const [timelineTab, setTimelineTab] = useState("upcoming");
  const [simMessage, setSimMessage] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [currentUser, setCurrentUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCloudTableReady, setIsCloudTableReady] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [profile, setProfile] = useState({
    fullName: "",
    phone: "",
    city: "",
    studentMode: true,
    monthlyBudget: 2500,
  });
  const appBaseUrl = import.meta.env.VITE_APP_URL || window.location.origin;

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setCurrentUser(data.session?.user || null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const errorCode = url.searchParams.get("error_code");
    const errorDescription = url.searchParams.get("error_description");
    if (!errorCode && !errorDescription) return;

    const readable = (errorDescription || "Authentication link is invalid.")
      .replace(/\+/g, " ")
      .trim();
    if (errorCode === "otp_expired") {
      setAuthError("Confirmation link expired. Please sign in again to receive a fresh link.");
    } else {
      setAuthError(readable);
    }

    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (!isCloudTableReady) return;
    getLatestUserDataset(currentUser.id)
      .then((latest) => {
        if (!latest?.subscriptions_detected) return;
        setSubscriptions(Array.isArray(latest.subscriptions_detected) ? latest.subscriptions_detected : []);
        setCancelled([]);
        setUploadedFileName(latest.uploaded_file_name || "");
      })
      .catch((fetchError) => {
        if (isUsersDataTableMissing(fetchError)) {
          setIsCloudTableReady(false);
          setError("");
          setToast("Cloud sync unavailable: users_data table not found.");
          window.setTimeout(() => setToast(""), 3200);
          return;
        }
      });
  }, [currentUser?.id, isCloudTableReady]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const raw = localStorage.getItem(`subtrackr_profile_${currentUser.id}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      setProfile((prev) => ({
        ...prev,
        ...parsed,
        studentMode:
          typeof parsed.studentMode === "boolean"
            ? parsed.studentMode
            : String(parsed.studentMode).toLowerCase() === "true",
        monthlyBudget: Number(parsed.monthlyBudget) || prev.monthlyBudget,
      }));
    } catch {
      // Ignore malformed local profile.
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (!isCloudTableReady) return;
    const channel = supabase
      .channel(`users-data-${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "users_data",
          filter: `user_id=eq.${currentUser.id}`,
        },
        async () => {
          try {
            const latest = await getLatestUserDataset(currentUser.id);
            if (latest?.subscriptions_detected) {
              setSubscriptions(
                Array.isArray(latest.subscriptions_detected) ? latest.subscriptions_detected : []
              );
            }
          } catch (fetchError) {
            if (isUsersDataTableMissing(fetchError)) {
              setIsCloudTableReady(false);
              setError("");
            }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, isCloudTableReady]);

  const insights = useMemo(
    () => buildInsights(subscriptions.filter((s) => !cancelled.includes(s.id))),
    [subscriptions, cancelled]
  );

  const hiddenSubscriptions = useMemo(
    () => detectHiddenSubscriptions(transactions),
    [transactions]
  );

  const categoryData = useMemo(
    () =>
      Object.entries(insights.byCategory).map(([name, value]) => ({
        name,
        value,
      })),
    [insights]
  );

  const visibleSubscriptions = useMemo(() => {
    const data = subscriptions.filter((s) => !cancelled.includes(s.id));
    if (tableSort === "priority") {
      return [...data].sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
    }
    return [...data].sort((a, b) => b.cost - a.cost);
  }, [subscriptions, cancelled, tableSort]);

  const projectionData = useMemo(() => {
    const monthly = insights.totalMonthly;
    return [
      { label: "3M", spend: monthly * 3 },
      { label: "6M", spend: monthly * 6 },
      { label: "1Y", spend: monthly * 12 },
    ];
  }, [insights.totalMonthly]);

  const timelineItems = useMemo(() => {
    return visibleSubscriptions
      .map((sub) => ({
        id: sub.id,
        name: sub.name,
        amount: sub.cost,
        nextPayment: sub.nextPayment ? new Date(sub.nextPayment) : null,
        lastPayment: sub.lastPayment ? new Date(sub.lastPayment) : null,
      }))
      .filter((x) => x.nextPayment || x.lastPayment)
      .sort((a, b) =>
        timelineTab === "upcoming"
          ? (a.nextPayment?.getTime() || 0) - (b.nextPayment?.getTime() || 0)
          : (b.lastPayment?.getTime() || 0) - (a.lastPayment?.getTime() || 0)
      );
  }, [visibleSubscriptions, timelineTab]);

  async function handleFile(file) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const txs = await parseFile(file);
      const subs = detectSubscriptions(txs);
      setTransactions(txs);
      setSubscriptions(subs);
      setCancelled([]);
      setUploadedFileName(file.name);
      if (currentUser?.id && isCloudTableReady) {
        try {
          await saveUserDataset({
            userId: currentUser.id,
            email: currentUser.email || "",
            uploadedFileName: file.name,
            totalSubscriptionSpend: subs.reduce((sum, s) => sum + s.cost, 0),
            subscriptionsDetected: subs,
            savingsAmount: 0,
          });
          setToast("Data saved successfully");
          window.setTimeout(() => setToast(""), 2500);
        } catch (saveError) {
          if (isUsersDataTableMissing(saveError)) {
            setIsCloudTableReady(false);
            setError("");
            setToast("CSV processed. Cloud sync is not configured yet.");
            window.setTimeout(() => setToast(""), 3000);
          } else {
            throw saveError;
          }
        }
      }
    } catch (e) {
      if (isUsersDataTableMissing(e)) {
        setIsCloudTableReady(false);
        setError("");
        setToast("CSV processed. Cloud sync is not configured yet.");
        window.setTimeout(() => setToast(""), 3000);
        return;
      }
      setError(e.message || "Could not process the file.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoData() {
    setError("");
    const subs = detectSubscriptions(demoTransactions);
    setTransactions(demoTransactions);
    setSubscriptions(subs);
    setCancelled([]);
    setUploadedFileName("demo_transactions.json");
    if (currentUser?.id && isCloudTableReady) {
      try {
        await saveUserDataset({
          userId: currentUser.id,
          email: currentUser.email || "",
          uploadedFileName: "demo_transactions.json",
          totalSubscriptionSpend: subs.reduce((sum, s) => sum + s.cost, 0),
          subscriptionsDetected: subs,
          savingsAmount: 0,
        });
        setToast("Data saved successfully");
        window.setTimeout(() => setToast(""), 2500);
      } catch (saveError) {
        if (isUsersDataTableMissing(saveError)) {
          setIsCloudTableReady(false);
          setError("");
          setToast("Demo loaded. Cloud sync is not configured yet.");
          window.setTimeout(() => setToast(""), 3000);
        } else {
          setError("Could not save demo data to cloud.");
        }
      }
    }
  }

  function onDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  }

  const spendValue = yearlyProjection ? insights.totalMonthly * 12 : insights.totalMonthly;
  const saveValue = yearlyProjection
    ? insights.potentialSavings * 12
    : insights.potentialSavings;
  const periodLabel = yearlyProjection ? "/year" : "/month";
  const studentBudget = Number(profile.monthlyBudget) || 2500;
  const overspend = Math.max(0, insights.totalMonthly - studentBudget);
  const yearlySavingFromCancel = cancelled
    .map((id) => subscriptions.find((sub) => sub.id === id)?.cost || 0)
    .reduce((sum, val) => sum + val, 0) * 12;
  const progressTarget = 5000;
  const savingsProgress = Math.min(100, (yearlySavingFromCancel / progressTarget) * 100);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");
    const email = form.email.trim().toLowerCase();
    const password = form.password.trim();
    const name = form.name.trim();

    if (!email || !password) {
      setAuthError("Email and password are required.");
      return;
    }

    if (authMode === "signup" && !name) {
      setAuthError("Name is required for sign up.");
      return;
    }

    if (authMode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          emailRedirectTo: `${appBaseUrl}/`,
        },
      });
      if (signUpError) {
        const msg = (signUpError.message || "").toLowerCase();
        const isEmailRateLimit =
          msg.includes("rate limit") ||
          msg.includes("email rate limit") ||
          msg.includes("too many requests");
        if (isEmailRateLimit) {
          // Graceful fallback: account may already exist; try direct password login.
          const { error: fallbackLoginError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (!fallbackLoginError) {
            setToast("Login successful");
            window.setTimeout(() => setToast(""), 2500);
            return;
          }
          setAuthError(
            "Email sending is temporarily rate-limited. Please wait a few minutes, then try Sign In."
          );
          return;
        }
        setAuthError(signUpError.message);
        return;
      }
      await sendAuthNotificationEmail(email);
      setToast("Signup successful. Check your email confirmation.");
      window.setTimeout(() => setToast(""), 2500);
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (loginError) {
      setAuthError(loginError.message);
      return;
    }
    await sendAuthNotificationEmail(email);
    setToast("Login successful");
    window.setTimeout(() => setToast(""), 2500);
  }

  function handleProfileSave() {
    if (!currentUser?.id) return;
    localStorage.setItem(`subtrackr_profile_${currentUser.id}`, JSON.stringify(profile));
    setToast("Profile settings saved");
    window.setTimeout(() => setToast(""), 2200);
  }

  function closeProfileModal() {
    setIsProfileOpen(false);
  }

  function logout() {
    supabase.auth.signOut();
    setCurrentUser(null);
    setForm({ name: "", email: "", password: "" });
    setToast("Logged out");
    window.setTimeout(() => setToast(""), 2000);
  }

  async function sendAuthNotificationEmail(email) {
    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
    if (!serviceId || !templateId || !publicKey) return;
    try {
      await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: email,
            message: "You have successfully logged into SubTrackr",
          },
        }),
      });
    } catch {
      // Keep auth flow successful even if optional mail service fails.
    }
  }

  if (!currentUser) {
    return (
      <div className={isDark ? "dark" : ""}>
        <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 transition-colors duration-500 dark:bg-deep dark:text-slate-100">
          <div className="mx-auto max-w-5xl">
            <header className="mb-8 flex items-center justify-between rounded-3xl border border-white/10 bg-gradient-to-r from-violet-600/15 via-sky-500/10 to-emerald-500/15 p-5 shadow-glow">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">SubTrackr</h1>
                <p className="mt-1 text-sm text-slate-300">
                  Freeze your subscriptions before they drain your money.
                </p>
              </div>
              <button
                onClick={() => setIsDark((v) => !v)}
                className="rounded-full border border-white/20 bg-white/10 p-2 transition hover:scale-105"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </header>

            {toast && (
              <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
                <CircleCheck size={16} />
                <span>{toast}</span>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="glass rounded-3xl p-6">
                <div className="mb-4 inline-flex rounded-xl bg-violet-500/20 p-2">
                  <ShieldCheck className="text-violet-300" />
                </div>
                <h2 className="text-2xl font-bold">Smart subscription control in INR</h2>
                <p className="mt-2 text-sm text-slate-300">
                  Upload bank transactions, detect recurring charges, and get "Cancel & Save"
                  recommendations in rupees.
                </p>
                <div className="mt-5 grid gap-3 text-sm">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    Detect monthly patterns by name, amount, and interval.
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    Identify high-cost subscriptions with warning indicators.
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    Show yearly projection of potential savings.
                  </div>
                </div>
              </section>

              <section className="glass rounded-3xl p-6">
                <div className="mb-5 flex rounded-xl bg-slate-900/40 p-1 text-sm">
                  <button
                    onClick={() => {
                      setAuthMode("signin");
                      setAuthError("");
                    }}
                    className={`flex-1 rounded-lg px-3 py-2 transition ${
                      authMode === "signin"
                        ? "bg-violet-500 text-white"
                        : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => {
                      setAuthMode("signup");
                      setAuthError("");
                    }}
                    className={`flex-1 rounded-lg px-3 py-2 transition ${
                      authMode === "signup"
                        ? "bg-violet-500 text-white"
                        : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    Sign Up
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  {authMode === "signup" && (
                    <label className="block">
                      <span className="mb-1 block text-sm text-slate-300">Full Name</span>
                      <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3">
                        <User size={16} className="text-slate-400" />
                        <input
                          value={form.name}
                          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                          className="w-full bg-transparent py-3 text-sm outline-none"
                          placeholder="Your name"
                        />
                      </div>
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-300">Email</span>
                    <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3">
                      <User size={16} className="text-slate-400" />
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                        className="w-full bg-transparent py-3 text-sm outline-none"
                        placeholder="you@example.com"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-300">Password</span>
                    <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3">
                      <Lock size={16} className="text-slate-400" />
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, password: e.target.value }))
                        }
                        className="w-full bg-transparent py-3 text-sm outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                  </label>

                  {authError && <p className="text-sm text-red-400">{authError}</p>}

                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-black transition hover:scale-[1.01] hover:bg-emerald-400"
                  >
                    {authMode === "signin" ? "Log In" : "Create Account"}
                    <ArrowRight size={16} />
                  </button>
                </form>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-500 dark:bg-deep dark:text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 flex items-center justify-between rounded-3xl border border-white/10 bg-gradient-to-r from-violet-600/15 via-sky-500/10 to-emerald-500/15 p-5 shadow-glow">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">SubTrackr</h1>
              <p className="mt-1 text-sm text-slate-300">
                Freeze your subscriptions before they drain your money.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsProfileOpen(true)}
                className="hidden rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-slate-200 transition hover:scale-105 sm:inline"
              >
                {currentUser?.user_metadata?.full_name || currentUser?.email}
              </button>
              <button
                onClick={() => setIsDark((v) => !v)}
                className="rounded-full border border-white/20 bg-white/10 p-2 transition hover:scale-105"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                onClick={logout}
                className="rounded-full border border-white/20 bg-white/10 p-2 transition hover:scale-105"
                aria-label="Logout"
              >
                <LogOut size={17} />
              </button>
            </div>
          </header>

          {toast && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
              <CircleCheck size={16} />
              <span>{toast}</span>
            </div>
          )}

          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="mb-6 rounded-3xl border border-dashed border-violet-400/40 p-6 text-center glass transition hover:border-violet-300 hover:shadow-glow"
          >
            <UploadCloud className="mx-auto mb-3 text-violet-300" />
            <h2 className="text-lg font-semibold">Upload transactions (CSV/JSON)</h2>
            <p className="mt-1 text-sm text-slate-300">
              Drag and drop your bank statement (in INR) or use file picker.
            </p>
            <div className="mx-auto mt-4 flex max-w-md flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <input
                type="file"
                accept=".csv,.json"
                className="block w-full max-w-xs rounded-xl border border-white/20 bg-white/10 p-2 text-sm"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <button
                onClick={handleDemoData}
                className="rounded-xl border border-violet-300/40 bg-violet-500/20 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:scale-105 hover:bg-violet-500/30"
              >
                Load Demo Data
              </button>
            </div>
            {loading && (
              <div className="mt-4 animate-pulse text-sm text-violet-300">
                Parsing transactions and detecting subscriptions...
              </div>
            )}
            {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
            {uploadedFileName && (
              <div className="mt-2 text-xs text-slate-400">
                Last dataset: <span className="text-slate-200">{uploadedFileName}</span>
              </div>
            )}
          </section>

          {Boolean(profile.studentMode) && insights.activeCount > 0 && (
            <section className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 text-amber-300" size={18} />
                <div>
                  <p className="font-semibold text-amber-200">
                    {overspend > 0
                      ? `You are overspending by ${currency(overspend)}/month`
                      : "You are within your student budget. Great control!"}
                  </p>
                  <p className="mt-1 text-sm text-amber-100/90">
                    Suggested saver action:{" "}
                    {suggestAlternative(visibleSubscriptions[0]?.name || "subscription")}
                  </p>
                </div>
              </div>
            </section>
          )}

          {Boolean(profile.studentMode) && (
            <section className="mb-6">
              <Panel title="Student Mode Insights">
                <div className="space-y-2 text-sm">
                  <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
                    Detecting overspending:{" "}
                    <span className="font-semibold">
                      {overspend > 0 ? `${currency(overspend)}/month above budget` : "On budget"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-sky-400/30 bg-sky-500/10 p-3">
                    Suggesting cheaper alternatives:{" "}
                    <span className="font-semibold">
                      {suggestAlternative(visibleSubscriptions[0]?.name || "subscription")}
                    </span>
                  </div>
                  <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
                    Providing clear, actionable alerts for high-cost and hidden subscriptions.
                  </div>
                </div>
              </Panel>
            </section>
          )}

          <div className="mb-6 flex items-center gap-2">
            <label className="text-sm font-medium text-slate-300">Yearly projection</label>
            <button
              onClick={() => setYearlyProjection((v) => !v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                yearlyProjection
                  ? "bg-emerald-500 text-black"
                  : "bg-slate-700 text-slate-200 hover:bg-slate-600"
              }`}
            >
              {yearlyProjection ? "ON" : "OFF"}
            </button>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              icon={<Wallet className="text-violet-300" />}
              title="Total Subscription Spend"
              value={`${currency(spendValue)}${periodLabel}`}
              highlight="Track your recurring outgoing money."
            />
            <Card
              icon={<IndianRupee className="text-sky-300" />}
              title="Active Subscriptions"
              value={insights.activeCount}
              highlight="Automatically detected monthly services."
            />
            <Card
              icon={<AlertTriangle className="text-emerald-300" />}
              title="Potential Savings"
              value={`${currency(saveValue)}${periodLabel}`}
              highlight="Recommendations based on high-cost items."
            />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Future Spending Predictor">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={projectionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(val) => currency(val)} />
                    <Line
                      type="monotone"
                      dataKey="spend"
                      stroke="#7c3aed"
                      strokeWidth={3}
                      dot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                You will spend {currency(insights.totalMonthly * 12)}/year on subscriptions.
              </p>
            </Panel>
            <Panel title="Gamified Savings Tracker">
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                <p className="text-sm text-emerald-200">
                  You saved {currency(yearlySavingFromCancel)} this year{" "}
                  {yearlySavingFromCancel > 0 ? (
                    <span className="inline-block animate-pulse">🎉</span>
                  ) : null}
                </p>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                    style={{ width: `${savingsProgress}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <Milestone size={14} /> ₹1,000
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Milestone size={14} /> ₹5,000
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Milestone size={14} /> ₹10,000
                  </span>
                </div>
              </div>
              {simMessage && (
                <p className="mt-2 animate-pulse text-sm text-emerald-300">{simMessage}</p>
              )}
            </Panel>
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Category-Wise Spend">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" outerRadius={100} label>
                      {categoryData.map((entry, index) => (
                        <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => currency(val)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Subscription Cost Comparison">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={visibleSubscriptions}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" hide />
                    <YAxis />
                    <Tooltip formatter={(val) => currency(val)} />
                    <Bar dataKey="cost" radius={[10, 10, 0, 0]}>
                      {visibleSubscriptions.map((entry, index) => (
                        <Cell
                          key={entry.id}
                          fill={entry.warning ? "#ef4444" : CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </section>

          <Panel title="Detected Subscriptions" className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="inline-flex items-center gap-2 text-xs text-slate-300">
                <Sparkles size={14} className="text-violet-300" />
                Sort subscriptions for better cancel decisions
              </div>
              <select
                value={tableSort}
                onChange={(e) => setTableSort(e.target.value)}
                className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs"
              >
                <option value="cost">Sort by Cost</option>
                <option value="priority">Sort by Cancel Priority</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-slate-300">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Cost</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Frequency</th>
                    <th className="p-3">Priority</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubscriptions.map((sub) => (
                    <tr
                      key={sub.id}
                      className="border-t border-white/10 transition hover:bg-white/5"
                    >
                      <td className="p-3">
                        <div className="font-medium">{sub.name}</div>
                        <div className="text-xs text-slate-400">
                          Confidence: {sub.confidence}% ({sub.transactionsCount} txns)
                        </div>
                      </td>
                      <td className={`p-3 font-semibold ${sub.warning ? "text-red-400" : ""}`}>
                        {currency(sub.cost)}
                      </td>
                      <td className="p-3">{sub.category}</td>
                      <td className="p-3">{sub.frequency}</td>
                      <td className="p-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            sub.priority === "High"
                              ? "bg-red-500/20 text-red-300"
                              : sub.priority === "Medium"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {sub.priority === "High"
                            ? "High 🔴"
                            : sub.priority === "Medium"
                              ? "Medium 🟡"
                              : "Low 🟢"}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => {
                            setCancelled((prev) => [...prev, sub.id]);
                            setSimMessage(
                              `You saved ${currency(sub.cost)}/month (${currency(
                                sub.cost * 12
                              )}/year)`
                            );
                            window.setTimeout(() => setSimMessage(""), 2400);
                          }}
                          className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-black transition hover:scale-105 hover:bg-emerald-400"
                        >
                          Cancel &amp; Save
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleSubscriptions.length && (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={6}>
                        Upload a file to detect subscriptions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Hidden Subscriptions">
              <div className="space-y-3">
                {hiddenSubscriptions.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{item.name}</p>
                      <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-300">
                        ⚠ Forgotten?
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      You may have forgotten this subscription: {currency(item.cost)} (
                      {item.frequency})
                    </p>
                  </div>
                ))}
                {hiddenSubscriptions.length === 0 && (
                  <p className="text-sm text-slate-400">
                    No hidden low-frequency subscriptions detected yet.
                  </p>
                )}
              </div>
            </Panel>

            <Panel title="Subscription Timeline">
              <div className="mb-3 flex rounded-xl bg-slate-900/40 p-1 text-xs">
                <button
                  onClick={() => setTimelineTab("upcoming")}
                  className={`flex-1 rounded-lg px-3 py-2 ${
                    timelineTab === "upcoming"
                      ? "bg-violet-500 text-white"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  Upcoming
                </button>
                <button
                  onClick={() => setTimelineTab("past")}
                  className={`flex-1 rounded-lg px-3 py-2 ${
                    timelineTab === "past"
                      ? "bg-violet-500 text-white"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  Past
                </button>
              </div>
              <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                {timelineItems.map((item) => (
                  <div
                    key={`${timelineTab}-${item.id}`}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10"
                  >
                    <CalendarClock size={16} className="mt-0.5 text-sky-300" />
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-slate-300">
                        {timelineTab === "upcoming" ? "Next" : "Last"} payment:{" "}
                        {(timelineTab === "upcoming" ? item.nextPayment : item.lastPayment)?.toLocaleDateString(
                          "en-IN"
                        )}{" "}
                        - {currency(item.amount)}
                      </p>
                    </div>
                  </div>
                ))}
                {timelineItems.length === 0 && (
                  <p className="text-sm text-slate-400">No timeline data available yet.</p>
                )}
              </div>
            </Panel>
          </section>

          {insights.recommendations.length > 0 && (
            <Panel title="Smart Recommendations" className="mt-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {insights.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm"
                  >
                    <p>{rec.text}</p>
                    <p className="mt-1 text-xs text-slate-300">{rec.alternative}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
      {isProfileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="glass w-full max-w-3xl rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Profile Settings</h2>
              <button
                onClick={closeProfileModal}
                className="rounded-lg border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                Full Name
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                  value={profile.fullName}
                  onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                  placeholder="Enter your full name"
                />
              </label>
              <label className="text-xs text-slate-300">
                Phone
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="10-digit mobile"
                />
              </label>
              <label className="text-xs text-slate-300">
                City
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                  value={profile.city}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                  placeholder="Your city"
                />
              </label>
              {Boolean(profile.studentMode) && (
                <label className="text-xs text-slate-300">
                  Student Monthly Budget (INR)
                  <input
                    type="number"
                    min="0"
                    className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                    value={profile.monthlyBudget}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, monthlyBudget: Number(e.target.value) || 0 }))
                    }
                  />
                </label>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-sm text-slate-200">Student Mode</span>
              <button
                onClick={() => setProfile((p) => ({ ...p, studentMode: !p.studentMode }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  profile.studentMode ? "bg-emerald-500 text-black" : "bg-slate-700 text-slate-200"
                }`}
              >
                {profile.studentMode ? "ON" : "OFF"}
              </button>
            </div>
            <button
              onClick={() => {
                handleProfileSave();
                closeProfileModal();
              }}
              className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold transition hover:scale-105"
            >
              Save Profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ icon, title, value, highlight }) {
  return (
    <div className="glass rounded-2xl p-4 shadow-xl transition duration-300 hover:-translate-y-1">
      <div className="mb-3 inline-flex rounded-lg bg-white/10 p-2">{icon}</div>
      <p className="text-sm text-slate-300">{title}</p>
      <h3 className="mt-1 text-2xl font-bold">{value}</h3>
      <p className="mt-1 text-xs text-slate-400">{highlight}</p>
    </div>
  );
}

function Panel({ title, children, className = "" }) {
  return (
    <section className={`glass rounded-2xl p-4 shadow-xl ${className}`}>
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}
