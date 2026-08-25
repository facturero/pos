import { prisma } from "./src/db.js";

const GATEWAY = process.env.ADMIN_API_BASE_URL ?? "http://127.0.0.1:8080";
const ROLE_ADMIN = "6a877759-4d2d-4f18-b05b-07ce28005eb3";
const EMAIL = `tmp-username-${Date.now()}@cmr.demo`;

async function main() {
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new Error("POS no emparejado");

  const ref = await fetch(`${GATEWAY}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: config.refreshToken }),
  });
  if (!ref.ok) throw new Error(`refresh ${ref.status}: ${await ref.text()}`);
  const { accessToken } = await ref.json();

  const inv = await fetch(`${GATEWAY}/users/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ email: EMAIL, roleIds: [ROLE_ADMIN] }),
  });
  const invBody = await inv.json();
  console.log(`INVITE ${inv.status}:`, JSON.stringify(invBody));

  const users = await fetch(`${GATEWAY}/users`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userList = await users.json();
  const u = userList.find((x) => x.email === EMAIL);
  console.log(`GET /users: status ${users.status}`);
  console.log(`NEW USER:`, JSON.stringify(u ?? "NOT FOUND"));
  console.log(`EMAIL: ${EMAIL}`);
}

main()
  .catch((e) => {
    console.error("ERR", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
