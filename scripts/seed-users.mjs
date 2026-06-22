const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env");
  console.error("Service role key: Supabase Dashboard → Settings → API → service_role");
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

const users = [
  { email: "ivan@noob.com", password: "123", role: "worker" },
  { email: "matvik@pro.com", password: "123", role: "manager" },
];

async function listUsers() {
  const response = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!response.ok) {
    throw new Error(`listUsers failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.users ?? [];
}

async function createUser(user) {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { role: user.role },
    }),
  });

  if (!response.ok) {
    throw new Error(`createUser failed: ${response.status} ${await response.text()}`);
  }
}

async function updateUser(id, user) {
  const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      password: user.password,
      email_confirm: true,
      user_metadata: { role: user.role },
    }),
  });

  if (!response.ok) {
    throw new Error(`updateUser failed: ${response.status} ${await response.text()}`);
  }
}

const existingUsers = await listUsers();

for (const user of users) {
  const found = existingUsers.find(
    (entry) => entry.email?.toLowerCase() === user.email.toLowerCase(),
  );

  try {
    if (found) {
      await updateUser(found.id, user);
      console.log(`Updated ${user.email} (${user.role})`);
    } else {
      await createUser(user);
      console.log(`Created ${user.email} (${user.role})`);
    }
  } catch (error) {
    console.error(`${user.email}:`, error instanceof Error ? error.message : error);
  }
}

console.log("Done.");
