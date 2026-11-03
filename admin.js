const adminStatus = document.querySelector("#admin-status");
const adminError = document.querySelector("#admin-error");
const invitationForm = document.querySelector("#invitation-form");
const invitationFeedback = document.querySelector("#invitation-feedback");
const invitationList = document.querySelector("#invitation-list");
const adminControls = document.querySelector("#admin-controls");
const signInLink = document.querySelector("#sign-in-link");
let csrfToken = null;

async function adminRequest(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Could not reach the account service. Please try again later.");
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || "The request could not be completed.");
  return result;
}

function showError(message) {
  adminError.textContent = message;
  adminError.classList.toggle("is-error", Boolean(message));
}

function makeInvitationRow(invitation) {
  const row = document.createElement("tr");
  [invitation.email, invitation.membership_tier, new Date(invitation.expires_at).toLocaleString(), invitation.status]
    .forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });

  const actionCell = document.createElement("td");
  if (invitation.status === "pending") {
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "mini-button";
    revoke.textContent = "Revoke";
    revoke.addEventListener("click", async () => {
      revoke.disabled = true;
      try {
        await adminRequest(`/api/admin/invitations/${encodeURIComponent(invitation.id)}/revoke`, {
          method: "POST",
          body: {},
        });
        await refreshInvitations();
      } catch (error) {
        showError(error.message);
        revoke.disabled = false;
      }
    });
    actionCell.append(revoke);
  } else {
    actionCell.textContent = "—";
  }
  row.append(actionCell);
  return row;
}

async function refreshInvitations() {
  const result = await adminRequest("/api/admin/invitations");
  invitationList.replaceChildren();
  if (result.invitations.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No invitations have been created.";
    row.append(cell);
    invitationList.append(row);
    return;
  }
  result.invitations.forEach((invitation) => invitationList.append(makeInvitationRow(invitation)));
}

async function initializeAdmin() {
  try {
    const session = await adminRequest("/api/auth/session");
    if (!session.authenticated) {
      adminStatus.textContent = "Sign in with an administrator account to manage invitations.";
      signInLink.hidden = false;
      return;
    }
    if (session.customer.role !== "admin") {
      adminStatus.textContent = "This account does not have administrator access.";
      signInLink.hidden = false;
      return;
    }
    csrfToken = session.csrfToken;
    if (!csrfToken) throw new Error("Your secure session needs to be refreshed. Sign in again.");

    const result = await adminRequest("/api/admin/membership-tiers");
    const select = invitationForm.elements.membershipTierId;
    select.replaceChildren(new Option("Select a tier", ""));
    result.tiers.forEach((tier) => select.add(new Option(tier.name, tier.id)));
    adminControls.hidden = false;
    signInLink.hidden = true;
    adminStatus.textContent = `Signed in as ${session.customer.email}.`;
    await refreshInvitations();
  } catch (error) {
    adminStatus.textContent = "Administrator tools are unavailable.";
    showError(error.message);
    signInLink.hidden = false;
  }
}

invitationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invitationForm.reportValidity()) return;
  const submit = invitationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  showError("");
  try {
    const values = new FormData(invitationForm);
    const expiresAt = new Date(values.get("expiresAt"));
    await adminRequest("/api/admin/invitations", {
      method: "POST",
      body: {
        email: values.get("email"),
        membershipTierId: values.get("membershipTierId"),
        expiresAt: expiresAt.toISOString(),
      },
    });
    invitationForm.reset();
    setInvitationExpiry();
    invitationFeedback.textContent = "Invitation created and sent by email.";
    invitationFeedback.classList.add("is-success");
    await refreshInvitations();
  } catch (error) {
    invitationFeedback.textContent = error.message;
    invitationFeedback.classList.remove("is-success");
    invitationFeedback.classList.add("is-error");
  } finally {
    submit.disabled = false;
  }
});

function setInvitationExpiry() {
  const input = invitationForm?.elements.expiresAt;
  if (!input) return;
  const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset());
  input.value = expiry.toISOString().slice(0, 16);
}

document.querySelector("#refresh-invitations")?.addEventListener("click", () => {
  refreshInvitations().catch((error) => showError(error.message));
});

setInvitationExpiry();
initializeAdmin();
