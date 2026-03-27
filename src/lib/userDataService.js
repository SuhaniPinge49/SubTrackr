import { supabase } from "./supabaseClient";

export async function saveUserDataset({
  userId,
  email,
  uploadedFileName,
  totalSubscriptionSpend,
  subscriptionsDetected,
  savingsAmount,
}) {
  const payload = {
    user_id: userId,
    email,
    uploaded_file_name: uploadedFileName,
    total_subscription_spend: totalSubscriptionSpend,
    subscriptions_detected: subscriptionsDetected,
    savings_amount: savingsAmount,
  };

  const { data, error } = await supabase.from("users_data").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function getLatestUserDataset(userId) {
  const { data, error } = await supabase
    .from("users_data")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
