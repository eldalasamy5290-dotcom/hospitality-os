const SUPABASE_URL = "https://bompffamehpexfklzfed.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvbXBmZmFtZWhwZXhma2x6ZmVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTY4MTcsImV4cCI6MjA4ODA3MjgxN30.TLWjVivBjPqBrEoTBr3rmi98sbSkPhVICjO9_RjaPmM";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("error");

  errorEl.textContent = "";

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  const user = data.user;
  if (!user) {
    errorEl.textContent = "Login failed";
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("restaurant_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    errorEl.textContent = "Profile not found";
    return;
  }

  localStorage.setItem("mia_restaurant_id", profile.restaurant_id);
  localStorage.setItem("mia_user_email", user.email || "");

  window.location.href = "/";
});
