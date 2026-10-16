import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  query,
  collection,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";
import { FIREBASE_API_KEY } from './firebase-config.js';

function showMessage(msg, color = "red") {
  const box = document.getElementById("message-box");
  if (!box) return;
  box.textContent = msg;
  box.style.color = color;
}

// Keep client validation in sync with server/routes/user.js
function isValidUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function safeUserPath(username) {
  // Only build /user/... links for validated usernames
  if (!isValidUsername(username)) return "/login";
  return `/user/${encodeURIComponent(username)}`;
}

function getUsernameFromUserPath() {
  const m = (window.location.pathname || "").match(/^\/user\/([^/]+)\/?$/);
  if (!m) return null;

  try {
    const decoded = decodeURIComponent(m[1]);
    return isValidUsername(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function openBioModal() {
  const modal = document.getElementById("bio-modal");
  const overlay = document.getElementById("bio-overlay");
  if (modal) modal.style.display = "block";
  if (overlay) overlay.style.display = "block";
}

function closeBioModal() {
  const modal = document.getElementById("bio-modal");
  const overlay = document.getElementById("bio-overlay");
  if (modal) modal.style.display = "none";
  if (overlay) overlay.style.display = "none";
}

// expose for your existing edit-bio-link click handler
window.openBioModal = openBioModal;
window.closeBioModal = closeBioModal;

// wire Close button (works even if user not logged in)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "close-bio-btn") {
    e.preventDefault();
    closeBioModal();
  }
});

const firebaseConfig = {
  apiKey: FIREBASE_API_KEY,
  authDomain: "openmediamap.firebaseapp.com",
  projectId: "openmediamap",
  storageBucket: "openmediamap.appspot.com",
  messagingSenderId: "161902617624",
  appId: "1:161902617624:web:66e529ec17f474510e0f6d",
  measurementId: "G-ZJR5DQMD57"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let isSigningUp = false;

// ---------------- AUTH STATE ----------------
onAuthStateChanged(auth, async (user) => {
  const usernameDisplay = document.getElementById("username-display");
  const userLinkContainer = document.getElementById("user-link-container");
  const adminLink = document.getElementById("admin-link");
  const loginPageLogout = document.getElementById("logout-btn");
  const topnavAuth = document.getElementById("topnav-auth");

  let username = null;

  if (user && !user.emailVerified && !isSigningUp) {
    await signOut(auth);
    return;
  }

  if (user) {
    // Admin check
    try {
      const tokenResult = await user.getIdTokenResult();
      if (tokenResult?.claims?.admin && adminLink) {
        adminLink.style.display = "inline-block";
        adminLink.classList.remove("hidden");
      }
    } catch (e) {
      console.error("Failed to read token claims:", e);
    }

    // Fetch username
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const u = userDoc.data().username;
        if (isValidUsername(u)) username = u;
      }
    } catch (err) {
      console.error("Failed to fetch username:", err);
    }
  }

  // Bottom-right username display (no innerHTML)
  if (usernameDisplay) {
    if (username) {
      usernameDisplay.replaceChildren();
      const a = document.createElement("a");
      a.href = safeUserPath(username);
      a.textContent = `@${username}`;
      usernameDisplay.appendChild(a);
      requestAnimationFrame(() => usernameDisplay.classList.add("visible"));
    } else {
      usernameDisplay.replaceChildren();
      usernameDisplay.classList.remove("visible");
    }
  }

  // Topnav login/logout
  if (topnavAuth) {
    topnavAuth.replaceChildren();

    if (user) {
      const a = document.createElement("a");
      a.href = "#";
      a.id = "topnav-logout-link";
      a.className = "page";
      a.textContent = "Logout";

      // defensive against CSS hiding it
      a.style.display = "inline-block";
      a.style.visibility = "visible";
      a.style.opacity = "1";

      a.onclick = async (e) => {
        e.preventDefault();
        await signOut(auth);
        window.location.href = "/login";
      };

      topnavAuth.appendChild(a);
    } else {
      const a = document.createElement("a");
      a.href = "/login";
      a.id = "topnav-login-link";
      a.className = "page";
      a.textContent = "Login";
      topnavAuth.appendChild(a);
    }

    topnavAuth.style.opacity = "1";
    topnavAuth.style.visibility = "visible";
    requestAnimationFrame(() => topnavAuth.classList.add("visible"));
  }

  // Sidebar login/logout
  if (userLinkContainer) {
    userLinkContainer.replaceChildren();

    if (username) {
      const aUser = document.createElement("a");
      aUser.href = safeUserPath(username);
      aUser.textContent = `@${username}`;
      aUser.className = "page";          // ✅ match nav styling
      aUser.style.display = "inline";    // ✅ defensive (prevents hidden/invisible)
      aUser.style.visibility = "visible";
      aUser.style.opacity = "1";

      const sep = document.createElement("span");
      sep.textContent = " · ";
      sep.style.margin = "0 6px";
      sep.style.display = "inline";
      sep.style.visibility = "visible";
      sep.style.opacity = "1";

      const aLogout = document.createElement("a");
      aLogout.href = "#";
      aLogout.id = "logout-link";
      aLogout.textContent = "Logout";
      aLogout.className = "page";        // ✅ match nav styling
      aLogout.style.display = "inline";
      aLogout.style.visibility = "visible";
      aLogout.style.opacity = "1";

      aLogout.onclick = async (e) => {
        e.preventDefault();
        await signOut(auth);
        // optional: send them to login page
        window.location.href = "/login";
      };

      userLinkContainer.appendChild(aUser);
      userLinkContainer.appendChild(sep);
      userLinkContainer.appendChild(aLogout);
    } else {
      const aLogin = document.createElement("a");
      aLogin.href = "/login";
      aLogin.textContent = "Login";
      aLogin.className = "page";
      userLinkContainer.appendChild(aLogin);
    }

    requestAnimationFrame(() => userLinkContainer.classList.add("visible"));
  }

  if (loginPageLogout) loginPageLogout.style.display = user ? "block" : "none";

  // BIO edit modal
  if (user) {
    const usernameOnPage = getUsernameFromUserPath(); // validated or null
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const data = userDocSnap.data() || {};

        // Only allow editing on your own profile page
        if (usernameOnPage && data.username === usernameOnPage) {
          const bioHeader = document.getElementById("bio-header");
          if (bioHeader && !document.querySelector(".edit-bio-link")) {
            const editLink = document.createElement("a");
            editLink.href = "#";
            editLink.textContent = "(edit bio)";
            editLink.classList.add("edit-bio-link");
            editLink.onclick = (e) => {
              e.preventDefault();
              if (typeof window.openBioModal === "function") window.openBioModal();
            };
            bioHeader.appendChild(document.createTextNode(" "));
            bioHeader.appendChild(editLink);
          }

          const bioInput = document.getElementById("bio-input");
          if (bioInput) bioInput.value = data.bio || "";

          const saveBioBtn = document.getElementById("save-bio-btn");
          if (saveBioBtn) {
            saveBioBtn.onclick = async () => {
              const newBio = (bioInput?.value || "").trim();

              // Optional: limit bio size to reduce abuse / huge writes
              if (newBio.length > 500) {
                showMessage("Bio is too long (max 500 characters).");
                return;
              }

              try {
                // Only update the field we intend (avoid clobbering other fields)
                await setDoc(userDocRef, { bio: newBio }, { merge: true });

                // If you add id="bio-text" on the server template, this updates live.
                const bioText = document.getElementById("bio-text");
                if (bioText) bioText.textContent = newBio || "No bio yet.";

                if (typeof window.closeBioModal === "function") window.closeBioModal();
              } catch (err) {
                console.error("Error updating bio:", err);
                showMessage("Failed to update bio. Try again.");
              }
            };
          }
        }
      }
    } catch (e) {
      console.error("Bio edit setup failed:", e);
    }
  }
});

// ---------------- LOGIN ----------------
window.login = async () => {
  showMessage("");
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";

  if (!email || !password) {
    showMessage("Please fill out both email and password.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await cred.user.reload();

    if (!cred.user.emailVerified) {
      await signOut(auth);

      const box = document.getElementById("message-box");
      if (box) {
        // This is static HTML you control (safe)
        box.innerHTML = `
          Please verify your email before logging in.
          Check your inbox and your spam/junk folder.
          <a href="#" id="resend-link">Resend verification email</a>
        `;
        box.style.color = "red";

        const resendLink = document.getElementById("resend-link");
        if (resendLink) {
          resendLink.onclick = async (e) => {
            e.preventDefault();
            await resendVerificationEmail(cred.user);
          };
        }
      }
      return;
    }

    const userDoc = await getDoc(doc(db, "users", cred.user.uid));
    if (!userDoc.exists()) {
      showMessage("User record not found. Contact support.");
      return;
    }

    const username = userDoc.data().username;
    if (!isValidUsername(username)) {
      showMessage("Invalid username on account. Contact support.");
      return;
    }

    window.location.href = safeUserPath(username);
  } catch (error) {
    console.error(error);
    let message = "Login failed. Please try again.";
    if (error.code === "auth/wrong-password") message = "Incorrect password.";
    else if (error.code === "auth/user-not-found") message = "No account found with this email.";
    else if (error.code === "auth/invalid-email") message = "Invalid email format.";
    showMessage(message);
  }
};

// ---------------- SIGNUP ----------------
window.showSignupUsername = () => {
  const u = document.getElementById("username");
  const s = document.getElementById("signup-btn");
  const sh = document.getElementById("show-signup-btn");
  if (u) u.style.display = "block";
  if (s) s.style.display = "inline-block";
  if (sh) sh.style.display = "none";
};

window.signup = async () => {
  showMessage("");

  const email = (document.getElementById("email")?.value || "").trim();
  const password = document.getElementById("password")?.value || "";
  const username = (document.getElementById("username")?.value || "").trim();

  if (!email || !password || !username) {
    showMessage("Please fill out all fields.");
    return;
  }

  // Match server validation to avoid broken /user/:username pages
  if (!isValidUsername(username)) {
    showMessage("Username must be 3–30 characters and only letters, numbers, or underscore.");
    return;
  }

  try {
    isSigningUp = true;

    const taken = await isUsernameTaken(username);
    if (taken) {
      showMessage("Username already taken.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await setDoc(doc(db, "users", cred.user.uid), {
      username,
      email: cred.user.email,
      created_at: new Date(),
      bio: ""
    });

    await sendEmailVerification(cred.user);
    await signOut(auth);

    showMessage(
      "Verification email sent. Please verify your email before logging in. " +
        "Check your inbox and your spam/junk folder if you don’t see it.",
      "green"
    );

    resetSignupUI();
  } catch (error) {
    console.error(error);
    if (error.code === "auth/email-already-in-use") showMessage("Email already in use. Try logging in.");
    else showMessage("Signup failed. Please try again.");
  } finally {
    isSigningUp = false;
  }
};

function resetSignupUI() {
  const usernameInput = document.getElementById("username");
  const signupBtn = document.getElementById("signup-btn");
  const showSignupBtn = document.getElementById("show-signup-btn");

  if (usernameInput) {
    usernameInput.style.display = "none";
    usernameInput.value = "";
  }
  if (signupBtn) signupBtn.style.display = "none";
  if (showSignupBtn) showSignupBtn.style.display = "inline-block";
}

window.logout = async () => {
  await signOut(auth);
  showMessage("Logged out!", "green");
};

async function isUsernameTaken(username) {
  const q = query(collection(db, "users"), where("username", "==", username));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

async function resendVerificationEmail(user) {
  try {
    await sendEmailVerification(user);
    showMessage("Verification email resent! Please check your inbox and your spam/junk folder.", "green");
  } catch (err) {
    console.error("Failed to resend verification email:", err);
    showMessage("Failed to resend email. Try again later.");
  }
}

export { app, auth, db, onAuthStateChanged };
// Forum-style pages on mobile: make the sidebar easier to toggle than the
// small round button alone. Tapping the page content collapses an expanded
// sidebar; tapping anywhere on the collapsed strip expands it again.
document.addEventListener("click", (e) => {
  const nav = document.querySelector(".vertical-tabs");
  if (!nav || !window.matchMedia("(max-width: 768px)").matches) return;
  if (e.target.closest(".tabs-toggle")) return; // button has its own handler

  const collapsed = nav.classList.contains("collapsed");
  if (!collapsed && e.target.closest(".forumcontent")) {
    nav.classList.add("collapsed");
  } else if (collapsed && nav.contains(e.target)) {
    e.preventDefault(); // don't follow a half-hidden tab link in the strip
    nav.classList.remove("collapsed");
  }
});

// Same pages: horizontal swipe toggles the sidebar. Swipe left collapses it
// (content gets the full width); swipe right brings it back.
let swipeStart = null;
document.addEventListener("touchstart", (e) => {
  swipeStart = e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target }
    : null;
}, { passive: true });

document.addEventListener("touchend", (e) => {
  const nav = document.querySelector(".vertical-tabs");
  const start = swipeStart;
  swipeStart = null;
  if (!start || !nav || !window.matchMedia("(max-width: 768px)").matches) return;
  if (start.target.closest("input, textarea, select, #bio-overlay")) return;

  const dx = e.changedTouches[0].clientX - start.x;
  const dy = e.changedTouches[0].clientY - start.y;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // not a clear horizontal swipe

  nav.classList.toggle("collapsed", dx < 0);
}, { passive: true });
