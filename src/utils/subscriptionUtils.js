import Papa from "papaparse";

const CATEGORY_KEYWORDS = {
  OTT: [
    "netflix",
    "hotstar",
    "jio cinema",
    "jiocinema",
    "prime video",
    "amazon prime",
    "sonyliv",
    "zee5",
    "youtube premium",
  ],
  "UPI/Payments": ["phonepe", "paytm", "gpay", "google pay", "mobikwik", "paypal"],
  EdTech: ["unacademy", "coursera", "udemy", "byju", "upgrad", "scaler"],
  Software: ["adobe", "aws", "github", "notion", "figma", "chatgpt", "openai", "canva"],
  Utilities: ["electric", "water", "gas", "internet", "wifi", "mobile", "phone", "fiber"],
  Fitness: ["gym", "cult", "fitpass", "health"],
  Productivity: ["dropbox", "evernote", "slack", "zoom", "microsoft", "google one"],
  Shopping: ["amazon", "flipkart", "instacart", "walmart+"],
  Other: [],
};

const CHEAPER_ALTERNATIVES = {
  spotify: "Try free Spotify tier or JioSaavn free.",
  netflix: "Try sharing family plan or switch to lower-tier OTT.",
  "adobe creative cloud": "Use Canva free / Figma starter for light usage.",
  "youtube premium": "Use standard YouTube with selective downloads.",
  "jio fiber": "Check lower speed plan with annual discount.",
};

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith(".json")) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result);
          resolve(normalizeTransactions(parsed));
        } catch (error) {
          reject(new Error("Invalid JSON file."));
        }
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsText(file);
      return;
    }

    if (fileName.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(normalizeTransactions(results.data)),
        error: () => reject(new Error("Unable to parse CSV.")),
      });
      return;
    }

    reject(new Error("Only JSON and CSV are supported."));
  });
}

function normalizeTransactions(rows) {
  const mapped = Array.isArray(rows)
    ? rows
        .map((item) => {
          const name = (
            item.name ||
            item.merchant ||
            item.description ||
            item.transaction ||
            ""
          )
            .toString()
            .trim();
          const amountRaw = item.amount ?? item.cost ?? item.debit ?? item.value;
          const amount = Number.parseFloat(amountRaw);
          const dateRaw = item.date || item.transactionDate || item.posted_at;
          const date = new Date(dateRaw);

          return {
            name,
            amount: Math.abs(amount),
            date,
          };
        })
        .filter(
          (x) =>
            x.name &&
            Number.isFinite(x.amount) &&
            x.amount > 0 &&
            Number.isFinite(x.date?.getTime())
        )
    : [];

  return mapped.sort((a, b) => a.date - b.date);
}

function getCategory(name) {
  const lower = name.toLowerCase();
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) {
      return category;
    }
  }
  return "Other";
}

function fuzzyName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function intervalInDays(d1, d2) {
  return Math.abs((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function detectSubscriptions(transactions) {
  const groups = new Map();

  transactions.forEach((tx) => {
    const amountBucket = Math.round(tx.amount);
    const key = `${fuzzyName(tx.name).slice(0, 16)}-${amountBucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  });

  const subscriptions = [];
  groups.forEach((items) => {
    if (items.length < 2) return;
    const sorted = [...items].sort((a, b) => a.date - b.date);
    const intervals = [];
    for (let i = 1; i < sorted.length; i += 1) {
      intervals.push(intervalInDays(sorted[i - 1].date, sorted[i].date));
    }

    const avgInterval =
      intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const isMonthly = avgInterval >= 24 && avgInterval <= 37;
    if (!isMonthly) return;

    const avgAmount =
      sorted.reduce((sum, tx) => sum + tx.amount, 0) / sorted.length;
    const monthly = Math.round(avgAmount);
    const name = sorted[0].name;
    const category = getCategory(name);

    subscriptions.push({
      id: `${name}-${monthly}`,
      name,
      cost: monthly,
      category,
      frequency: "Monthly",
      intervalDays: Math.round(avgInterval),
      lastPayment: sorted[sorted.length - 1].date,
      nextPayment: addDays(sorted[sorted.length - 1].date, Math.round(avgInterval)),
      confidence: Math.min(99, Math.round((sorted.length / 6) * 100)),
      transactionsCount: sorted.length,
      warning: monthly >= 1000,
      priority: getCancelPriority({ cost: monthly, confidence: sorted.length }),
    });
  });

  return subscriptions.sort((a, b) => b.cost - a.cost);
}

export function buildInsights(subscriptions) {
  const totalMonthly = subscriptions.reduce((sum, s) => sum + s.cost, 0);
  const byCategory = subscriptions.reduce((acc, sub) => {
    acc[sub.category] = (acc[sub.category] || 0) + sub.cost;
    return acc;
  }, {});

  const recommendations = subscriptions
    .filter((s) => s.cost > totalMonthly * 0.15 || s.warning)
    .slice(0, 3)
    .map((s) => ({
      id: s.id,
      text: `Cancel & Save ₹${s.cost}/month from ${s.name}`,
      monthlySaving: s.cost,
      alternative: suggestAlternative(s.name),
    }));

  return {
    totalMonthly,
    activeCount: subscriptions.length,
    potentialSavings: recommendations.reduce((sum, r) => sum + r.monthlySaving, 0),
    byCategory,
    recommendations,
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCancelPriority({ cost, confidence }) {
  if (cost >= 1000 || confidence <= 45) return "High";
  if (cost >= 400 || confidence <= 70) return "Medium";
  return "Low";
}

export function suggestAlternative(name) {
  const lower = name.toLowerCase();
  const key = Object.keys(CHEAPER_ALTERNATIVES).find((item) => lower.includes(item));
  return key ? CHEAPER_ALTERNATIVES[key] : "Check annual plan discounts or student offers.";
}

export function detectHiddenSubscriptions(transactions) {
  const groups = new Map();
  transactions.forEach((tx) => {
    const amountBucket = Math.round(tx.amount);
    const key = `${fuzzyName(tx.name).slice(0, 16)}-${amountBucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  });

  const hidden = [];
  groups.forEach((items) => {
    if (items.length < 2) return;
    const sorted = [...items].sort((a, b) => a.date - b.date);
    const intervals = [];
    for (let i = 1; i < sorted.length; i += 1) {
      intervals.push(intervalInDays(sorted[i - 1].date, sorted[i].date));
    }
    const avgInterval =
      intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    if (avgInterval < 55 || avgInterval > 110) return;

    const avgAmount =
      sorted.reduce((sum, tx) => sum + tx.amount, 0) / sorted.length;
    hidden.push({
      id: `hidden-${sorted[0].name}-${Math.round(avgAmount)}`,
      name: sorted[0].name,
      cost: Math.round(avgAmount),
      frequency: `Every ${Math.round(avgInterval)} days`,
      lastPayment: sorted[sorted.length - 1].date,
      nextPayment: addDays(sorted[sorted.length - 1].date, Math.round(avgInterval)),
    });
  });

  return hidden.sort((a, b) => b.cost - a.cost);
}

export const demoTransactions = [
  { name: "Netflix India", amount: 649, date: "2025-11-03" },
  { name: "Netflix India", amount: 649, date: "2025-12-03" },
  { name: "Netflix India", amount: 649, date: "2026-01-03" },
  { name: "Spotify Premium", amount: 119, date: "2025-11-09" },
  { name: "Spotify Premium", amount: 119, date: "2025-12-09" },
  { name: "Spotify Premium", amount: 119, date: "2026-01-09" },
  { name: "Adobe Creative Cloud", amount: 1675, date: "2025-11-14" },
  { name: "Adobe Creative Cloud", amount: 1675, date: "2025-12-14" },
  { name: "Adobe Creative Cloud", amount: 1675, date: "2026-01-14" },
  { name: "Jio Fiber", amount: 999, date: "2025-11-20" },
  { name: "Jio Fiber", amount: 999, date: "2025-12-20" },
  { name: "Jio Fiber", amount: 999, date: "2026-01-20" },
  { name: "YouTube Premium", amount: 129, date: "2025-11-06" },
  { name: "YouTube Premium", amount: 129, date: "2025-12-06" },
  { name: "YouTube Premium", amount: 129, date: "2026-01-06" },
  { name: "Coursera Plus", amount: 499, date: "2025-10-21" },
  { name: "Coursera Plus", amount: 499, date: "2025-12-21" },
  { name: "Coursera Plus", amount: 499, date: "2026-02-21" },
  { name: "PhonePe Gold", amount: 299, date: "2025-10-17" },
  { name: "PhonePe Gold", amount: 299, date: "2025-12-18" },
  { name: "PhonePe Gold", amount: 299, date: "2026-02-18" },
].map((tx) => ({ ...tx, date: new Date(tx.date) }));
