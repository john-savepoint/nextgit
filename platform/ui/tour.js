// nextgit — interactive tour logic (vanilla ES module)
// Zero external dependencies, pure standard browser APIs.

/**
 * Tour State
 */
const state = {
  currentStep: 0,
  totalSteps: 10,
  // Sim 1 state
  sim1Mode: "github", // 'github' | 'fleet'
  sim1GithubSelectedPr: 0,
  // Sim 2 state
  sim2Spawned: false,
  // Sim 3 state
  sim3Attempted: true,
  // Sim 4 state
  sim4Status: "idle", // 'idle' | 'shipping' | 'landed'
  // Real proposals data
  realProposals: null,
  realLoading: true,
  realError: null,
  // Quiz state
  quizAnswer: null,
};

/**
 * Fallback static proposals matching live platform data if API is unreachable
 */
const fallbackProposals = [
  {
    repo: "agent-1",
    intent: "Feature: refreshSession() extends a live session by TTL",
    files: [{ path: "src/auth.ts", additions: 5, deletions: 0 }],
    landing: { status: "ready" },
    collidesWith: "agent-2",
  },
  {
    repo: "agent-2",
    intent: "Fix: tolerate clock skew in isExpired via leewayMs",
    files: [{ path: "src/auth.ts", additions: 2, deletions: 2 }],
    landing: { status: "ready" },
    collidesWith: "agent-1",
  },
  {
    repo: "agent-3",
    intent: "Perf: read-through memo cache for store reads",
    files: [{ path: "src/store.ts", additions: 0, deletions: 0 }],
    landing: { status: "landed" },
    collidesWith: null,
  },
  {
    repo: "agent-4",
    intent: "Feature: feature-flag module with isEnabled()",
    files: [{ path: "src/feature.ts", additions: 43, deletions: 0 }],
    landing: { status: "ready" },
    collidesWith: null,
  },
];

/**
 * Elements cache
 */
const el = {
  progressFill: document.getElementById("progress-fill"),
  stepIndicators: document.getElementById("step-indicators"),
  stepCards: Array.from(document.querySelectorAll(".step-card")),
  btnPrev: document.getElementById("btn-prev"),
  btnNext: document.getElementById("btn-next"),
  stepDisplay: document.getElementById("step-display-indicator"),
  btnRestartTour: document.getElementById("btn-restart-tour"),

  // Sim 1
  btnViewGithub: document.getElementById("btn-view-github"),
  btnViewFleet: document.getElementById("btn-view-fleet"),
  sim1Viewport: document.getElementById("sim1-viewport"),
  sim1Explanation: document.getElementById("sim1-explanation"),

  // Sim 2
  btnSpawnWorkspaces: document.getElementById("btn-spawn-workspaces"),
  btnResetWorkspaces: document.getElementById("btn-reset-workspaces"),
  sim2Branches: document.getElementById("sim2-branches"),
  sim2Explanation: document.getElementById("sim2-explanation"),

  // Step 3 Annotated card
  annotatedRegions: Array.from(document.querySelectorAll(".annotated-region")),
  detailsBadge: document.getElementById("details-pane-badge"),
  detailsTitle: document.getElementById("details-pane-title"),
  detailsDesc: document.getElementById("details-pane-desc"),

  // Sim 3
  btnSim3Merge: document.getElementById("btn-sim3-merge"),
  btnSim3Reset: document.getElementById("btn-sim3-reset"),
  sim3ResultContainer: document.getElementById("sim3-result-container"),
  sim3Explanation: document.getElementById("sim3-explanation"),

  // Sim 4
  sim4Card: document.getElementById("sim4-card"),
  btnSim4Ship: document.getElementById("btn-sim4-ship"),
  btnSim4Reset: document.getElementById("btn-sim4-reset"),
  sim4Terminal: document.getElementById("sim4-terminal"),
  sim4Explanation: document.getElementById("sim4-explanation"),

  // Step 6 Live proposals
  liveStatus: document.getElementById("live-proposals-status"),
  liveGrid: document.getElementById("live-proposals-grid"),

  // Step 7 Quiz
  quizButtons: Array.from(document.querySelectorAll("[data-quiz]")),
  quizFeedback: document.getElementById("quiz-feedback"),
};

/**
 * Pure helper: Escape HTML
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Stepper navigation
 */
function goToStep(index) {
  if (index < 0 || index >= state.totalSteps) return;
  state.currentStep = index;

  // Update step cards
  el.stepCards.forEach((card, idx) => {
    if (idx === index) {
      card.classList.add("is-active");
    } else {
      card.classList.remove("is-active");
    }
  });

  // Update stepper buttons
  const stepBtns = el.stepIndicators.querySelectorAll(".step-btn");
  stepBtns.forEach((btn, idx) => {
    if (idx === index) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
    if (idx < index) {
      btn.classList.add("is-completed");
    } else {
      btn.classList.remove("is-completed");
    }
  });

  // Update progress bar
  const progressPercent = ((index + 1) / state.totalSteps) * 100;
  if (el.progressFill) {
    el.progressFill.style.width = `${progressPercent}%`;
  }

  // Update buttons
  if (el.btnPrev) {
    el.btnPrev.disabled = index === 0;
  }
  if (el.btnNext) {
    if (index === state.totalSteps - 1) {
      el.btnNext.textContent = "Finish Tour";
    } else {
      el.btnNext.textContent = "Next";
    }
  }
  if (el.stepDisplay) {
    el.stepDisplay.textContent = `Step ${index + 1} of ${state.totalSteps}`;
  }

  // Scroll to top of stage
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * MINI-SIM 1: GitHub View vs Fleet View
 */
const sim1Prs = [
  { id: "#101", author: "agent-1", title: "Add session TTL extension", file: "src/auth.ts", lines: "+5 / -0" },
  { id: "#102", author: "agent-2", title: "Allow leewayMs clock skew", file: "src/auth.ts", lines: "+2 / -2" },
  { id: "#103", author: "agent-3", title: "Store memoization cache", file: "src/store.ts", lines: "Landed" },
  { id: "#104", author: "agent-4", title: "Feature flag system", file: "src/feature.ts", lines: "+43 / -0" },
];

function renderSim1() {
  if (!el.sim1Viewport) return;

  if (state.sim1Mode === "github") {
    el.btnViewGithub.classList.add("is-active");
    el.btnViewFleet.classList.remove("is-active");

    const pr = sim1Prs[state.sim1GithubSelectedPr];
    el.sim1Viewport.innerHTML = `
      <div class="view-github-mode">
        <div class="gh-tabs">
          ${sim1Prs
            .map(
              (p, idx) => `
            <button class="gh-tab ${idx === state.sim1GithubSelectedPr ? "is-active" : ""}" type="button" data-sim1-tab="${idx}">
              PR ${p.id} (${p.author})
            </button>
          `
            )
            .join("")}
        </div>
        <div class="gh-pr-view">
          <div class="gh-pr-title">PR ${pr.id}: ${pr.title}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
            Author: <strong>${pr.author}</strong> · Touches: <code>${pr.file}</code> (${pr.lines})
          </div>
          <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
            GitHub evaluates this pull request strictly against main in isolation.
            Status: checks passed, ready to merge.
          </p>
          <div class="gh-blindspot">
            <strong>The Blindspot:</strong> GitHub does not warn you that PR #101 and PR #102 modify the exact same lines of src/auth.ts.
            Merging #101 now will silently break #102.
          </div>
        </div>
      </div>
    `;

    el.sim1Explanation.innerHTML = `
      You are viewing <strong>1 PR at a time</strong>. You have to click back and forth between tabs and manually check filenames to detect overlap.
    `;
  } else {
    el.btnViewGithub.classList.remove("is-active");
    el.btnViewFleet.classList.add("is-active");

    el.sim1Viewport.innerHTML = `
      <div class="view-fleet-mode">
        <div class="fleet-card has-conflict">
          <div class="fleet-repo">agent-1</div>
          <div class="fleet-intent">Feature: refreshSession() extends TTL</div>
          <div style="color: var(--text-muted); font-size: 0.6875rem; margin-bottom: 0.4rem;">touches src/auth.ts</div>
          <span class="fleet-tag tag-conflict">Collides with agent-2</span>
        </div>
        <div class="fleet-card has-conflict">
          <div class="fleet-repo">agent-2</div>
          <div class="fleet-intent">Fix: clock skew in isExpired</div>
          <div style="color: var(--text-muted); font-size: 0.6875rem; margin-bottom: 0.4rem;">touches src/auth.ts</div>
          <span class="fleet-tag tag-conflict">Collides with agent-1</span>
        </div>
        <div class="fleet-card is-landed">
          <div class="fleet-repo">agent-3</div>
          <div class="fleet-intent">Perf: store memoization cache</div>
          <div style="color: var(--text-muted); font-size: 0.6875rem; margin-bottom: 0.4rem;">touches src/store.ts</div>
          <span class="fleet-tag tag-landed">Already landed</span>
        </div>
        <div class="fleet-card">
          <div class="fleet-repo">agent-4</div>
          <div class="fleet-intent">Feature: feature-flag module</div>
          <div style="color: var(--text-muted); font-size: 0.6875rem; margin-bottom: 0.4rem;">touches src/feature.ts</div>
          <span class="fleet-tag tag-clean">Safe to ship</span>
        </div>
      </div>
    `;

    el.sim1Explanation.innerHTML = `
      <strong>Fleet View:</strong> All active agents appear on one screen. The collision between agent-1 and agent-2 on <code>src/auth.ts</code> is immediately visible without opening a single PR tab.
    `;
  }
}

/**
 * MINI-SIM 2: Workspaces Branching
 */
const sim2Agents = [
  { name: "agent-1", role: "Session Auth", task: "Add refreshSession() to src/auth.ts" },
  { name: "agent-2", role: "Time Sync", task: "Fix clock skew in isExpired()" },
  { name: "agent-3", role: "Performance", task: "Implement memo cache in src/store.ts" },
  { name: "agent-4", role: "Growth", task: "Build feature-flag module in src/feature.ts" },
];

function renderSim2() {
  if (!el.sim2Branches) return;

  if (!state.sim2Spawned) {
    el.sim2Branches.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-subtle);">
        No active workspaces. Click "Give 4 agents tasks" above.
      </div>
    `;
    el.sim2Explanation.innerHTML = `Baseline repository is ready. Waiting to branch workspaces for workers.`;
  } else {
    el.sim2Branches.innerHTML = sim2Agents
      .map(
        (a, i) => `
      <div class="sim2-branch-card is-spawned" style="transition-delay: ${i * 70}ms;">
        <div class="agent-title">${a.name}</div>
        <div class="task-desc">${a.task}</div>
        <div style="font-size: 0.625rem; color: var(--status-green);">Isolated workspace created</div>
      </div>
    `
      )
      .join("");

    el.sim2Explanation.innerHTML = `
      <strong>4 workspaces spawned.</strong> Each agent receives its own lightweight git sandbox. They can edit and test without stepping on each other's toes.
    `;
  }
}

/**
 * STEP 3: Annotated Proposal Card
 */
const cardAnnotations = {
  repo: {
    badge: "Identity",
    title: "Agent Repository & Target",
    desc: "Identifies which agent workspace submitted this work. It displays the branch name, the baseline target repo (demo:main), and whether the proposal is active or already landed.",
  },
  intent: {
    badge: "Intent",
    title: "Git-Notes Intent Field",
    desc: "A plain-language summary of what the agent set out to do. NextGit extracts this directly from commit metadata so you do not have to decipher cryptic commit messages.",
  },
  stats: {
    badge: "Diff Metrics",
    title: "Files and Line Counts",
    desc: "Compact summary of additions (+5) and deletions (-0). Helps you instantly gauge the blast radius of the agent's work.",
  },
  files: {
    badge: "File Manifest",
    title: "Modified File List",
    desc: "Every file touched by this proposal with status indicators (M for modified, A for added, D for deleted). Clicking reveals the raw hunk diff.",
  },
  actions: {
    badge: "Action Controls",
    title: "Preview & Land Buttons",
    desc: "Allows you to test-merge the proposal in memory or trigger the serverless landing pipeline to push changes directly into the baseline default branch.",
  },
};

function selectAnnotatedPart(partKey) {
  const data = cardAnnotations[partKey];
  if (!data) return;

  el.annotatedRegions.forEach((reg) => {
    if (reg.getAttribute("data-part") === partKey) {
      reg.classList.add("is-inspected");
    } else {
      reg.classList.remove("is-inspected");
    }
  });

  if (el.detailsBadge) el.detailsBadge.textContent = data.badge;
  if (el.detailsTitle) el.detailsTitle.textContent = data.title;
  if (el.detailsDesc) el.detailsDesc.textContent = data.desc;
}

/**
 * MINI-SIM 3: Collision Simulation
 */
function renderSim3() {
  if (!el.sim3ResultContainer) return;

  if (state.sim3Attempted) {
    el.sim3ResultContainer.innerHTML = `
      <div class="sim3-result">
        <div class="sim3-result-header">Collision Detected in src/auth.ts (agent-1 x agent-2)</div>
        <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
          NextGit executed an in-memory 3-way merge using the common ancestor. Both agents modified lines 12–15:
        </p>
        <div class="conflict-region">
<<<<<<< agent-1 (adds refreshSession right before isExpired)
export function refreshSession(session: Session, ttlMs = DEFAULT_TTL_MS): Session {
  return { ...session, expiresAt: Date.now() + ttlMs };
}
======= agent-2 (modifies isExpired signature with leewayMs)
export function isExpired(session: Session, now = Date.now(), leewayMs = 0): boolean {
  return now > session.expiresAt + leewayMs;
>>>>>>>
        </div>
      </div>
    `;

    el.sim3Explanation.innerHTML = `
      <strong>Collision caught before merge!</strong> If you shipped agent-1 first, agent-2's branch would become unmergeable. NextGit flags this pair in red so you can intervene.
    `;
  } else {
    el.sim3ResultContainer.innerHTML = `
      <div style="padding: 1rem; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-subtle); margin-top: 0.75rem; font-size: 0.75rem;">
        No merge attempted yet. Both snippets are pending.
      </div>
    `;
    el.sim3Explanation.innerHTML = `
      Click <strong>Try to ship both</strong> to execute the merge attempt.
    `;
  }
}

/**
 * MINI-SIM 4: Shipping Simulation
 */
function renderSim4() {
  if (!el.sim4Card) return;

  if (state.sim4Status === "idle") {
    el.sim4Card.classList.remove("is-landed");
    el.btnSim4Ship.disabled = false;
    el.btnSim4Ship.textContent = "Ship it";
    el.sim4Terminal.innerHTML = `Ready to ship agent-4 into demo:main. No conflicts detected.`;
    el.sim4Explanation.innerHTML = `Click <strong>Ship it</strong> to execute the serverless merge pipeline.`;
  } else if (state.sim4Status === "shipping") {
    el.btnSim4Ship.disabled = true;
    el.btnSim4Ship.textContent = "Shipping...";
    el.sim4Terminal.innerHTML = `
      <div class="terminal-step">1. POST /land { base: "demo", repos: ["agent-4"] }</div>
      <div class="terminal-step">2. Verifying 3-way diff against ancestor commit... OK</div>
      <div class="terminal-step">3. Creating merge tree and commit object...</div>
    `;
  } else if (state.sim4Status === "landed") {
    el.sim4Card.classList.add("is-landed");
    el.btnSim4Ship.disabled = true;
    el.btnSim4Ship.textContent = "Landed";
    el.sim4Terminal.innerHTML = `
      <div class="terminal-step success">[OK] Push successful: ref main updated on demo.</div>
      <div class="terminal-step success">[OK] Commit: e7f8a12 landed.</div>
      <div class="terminal-step" style="color: var(--accent-blue);">Proposal status: landed — nothing pending.</div>
    `;
    el.sim4Explanation.innerHTML = `
      <strong>Landed!</strong> The proposal folded cleanly onto the main branch without downloading a single git file locally.
    `;
  }
}

/**
 * STEP 6: Real Proposals Fetch & Render
 */
async function loadRealProposals() {
  if (!el.liveGrid || !el.liveStatus) return;

  el.liveStatus.textContent = "Connecting to https://nextgit-platform.john-b7d.workers.dev/proposals?base=demo...";

  try {
    const res = await fetch("https://nextgit-platform.john-b7d.workers.dev/proposals?base=demo");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !data.proposals) throw new Error("Malformed API response");

    state.realProposals = data.proposals.slice(0, 4);
    state.realConflicts = data.conflicts || [];
    el.liveStatus.className = "callout callout-clean";
    el.liveStatus.innerHTML = `
      <strong>Live connection established:</strong> Loaded ${data.proposals.length} proposals from <code>nextgit-platform</code>.
    `;
    renderRealProposalsCards();
  } catch (err) {
    // Graceful offline fallback
    console.warn("Could not fetch live proposals, using fallback snapshot:", err);
    state.realProposals = fallbackProposals;
    state.realConflicts = [
      {
        file: "src/auth.ts",
        repos: ["agent-1", "agent-2"],
      },
    ];
    el.liveStatus.className = "callout callout-warn";
    el.liveStatus.innerHTML = `
      <strong>Offline Fallback Snapshot:</strong> Could not connect to live backend (${escapeHtml(err.message)}). Displaying verified demo data.
    `;
    renderRealProposalsCards();
  }
}

function renderRealProposalsCards() {
  if (!el.liveGrid || !state.realProposals) return;

  const cardsHtml = state.realProposals
    .map((p) => {
      const isLanded = p.landing?.status === "landed";
      const hasConflict =
        p.repo === "agent-1" ||
        p.repo === "agent-2" ||
        (state.realConflicts && state.realConflicts.some((c) => c.repos?.includes(p.repo)));

      let cardClass = "live-tour-card";
      let annTag = "";

      if (isLanded) {
        cardClass += " is-landed";
        annTag = `<span class="live-card-annotation ann-landed">Already shipped to main</span>`;
      } else if (hasConflict) {
        cardClass += " is-conflict";
        // Derive the collision file(s) from the live conflict data for THIS
        // proposal so the annotation is truthful for every pair, not just the
        // src/auth.ts demo pair. Fall back to "src/auth.ts" only when no
        // conflict data is present (the offline-snapshot synthetic case,
        // which carries {file:"src/auth.ts", repos:["agent-1","agent-2"]}).
        const collisionFiles = (state.realConflicts || [])
          .filter((c) => c.repos?.includes(p.repo))
          .map((c) => c.file)
          .filter((v, i, a) => a.indexOf(v) === i);
        const collisionLabel = collisionFiles.length > 0 ? collisionFiles.join(", ") : "src/auth.ts";
        annTag = `<span class="live-card-annotation ann-conflict">Collides on ${escapeHtml(collisionLabel)}</span>`;
      } else {
        cardClass += " is-clean";
        annTag = `<span class="live-card-annotation ann-clean">Clean &amp; ready to ship</span>`;
      }

      const files = p.files || [];
      const stats = p.stats || { files: files.length, additions: 0, deletions: 0 };

      return `
      <div class="${cardClass}">
        ${annTag}
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:0.25rem;">
          <span style="font-weight:600; color:var(--accent-blue);">${escapeHtml(p.repo)}</span>
          <span style="font-size:0.6875rem; color:var(--text-muted);">${isLanded ? "landed" : "ready"}</span>
        </div>
        <div class="proposal-intent" style="margin:0; font-size:0.75rem;">
          <span class="intent-label">intent:</span> ${escapeHtml(p.intent || "No intent description")}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.6875rem; color:var(--text-secondary);">
          <span>${escapeHtml(files[0]?.path || "no files")}</span>
          <span>+${stats.additions ?? 0} / -${stats.deletions ?? 0}</span>
        </div>
      </div>
    `;
    })
    .join("");

  el.liveGrid.innerHTML = cardsHtml;
}

/**
 * STEP 7: Exercise / Quiz
 */
const quizAnswers = {
  "agent-1": {
    type: "conflict",
    headline: "Risky: agent-1 collides with agent-2",
    explanation:
      "agent-1 adds refreshSession() in src/auth.ts on the exact same lines where agent-2 modifies isExpired(). Shipping agent-1 now will make agent-2 unmergeable without manual intervention.",
  },
  "agent-2": {
    type: "conflict",
    headline: "Risky: agent-2 collides with agent-1",
    explanation:
      "agent-2 edits isExpired() on the same function boundary where agent-1 adds code. NextGit flags this collision in red.",
  },
  "agent-3": {
    type: "landed",
    headline: "Already Shipped: agent-3 has landed",
    explanation:
      "agent-3's store memoization cache was already folded into the baseline demo repository. There are zero pending changes to ship.",
  },
  "agent-4": {
    type: "safe",
    headline: "Optimal choice: agent-4 is clean and safe to ship",
    explanation:
      "agent-4 creates a brand new isolated file (src/feature.ts). It touches zero shared lines and has no collisions with any other agent. NextGit can land it cleanly in one click.",
  },
};

function handleQuizChoice(repoKey) {
  state.quizAnswer = repoKey;
  const feedback = quizAnswers[repoKey];
  if (!feedback) return;

  el.quizButtons.forEach((btn) => {
    if (btn.getAttribute("data-quiz") === repoKey) {
      btn.classList.add("is-selected");
    } else {
      btn.classList.remove("is-selected");
    }
  });

  if (el.quizFeedback) {
    el.quizFeedback.hidden = false;
    el.quizFeedback.className = `quiz-feedback feedback-${feedback.type}`;
    el.quizFeedback.innerHTML = `
      <div class="feedback-headline">${escapeHtml(feedback.headline)}</div>
      <p>${escapeHtml(feedback.explanation)}</p>
    `;
  }
}

/**
 * Event Listeners & Setup
 */
function initEventListeners() {
  // Navigation
  el.btnPrev?.addEventListener("click", () => goToStep(state.currentStep - 1));
  el.btnNext?.addEventListener("click", () => {
    if (state.currentStep === state.totalSteps - 1) {
      window.location.href = "index.html";
    } else {
      goToStep(state.currentStep + 1);
    }
  });
  el.btnRestartTour?.addEventListener("click", () => goToStep(0));

  // Stepper tab buttons
  el.stepIndicators?.addEventListener("click", (e) => {
    const btn = e.target.closest(".step-btn");
    if (!btn) return;
    const stepIdx = parseInt(btn.getAttribute("data-step"), 10);
    if (!isNaN(stepIdx)) goToStep(stepIdx);
  });

  // Sim 1
  el.btnViewGithub?.addEventListener("click", () => {
    state.sim1Mode = "github";
    renderSim1();
  });
  el.btnViewFleet?.addEventListener("click", () => {
    state.sim1Mode = "fleet";
    renderSim1();
  });
  el.sim1Viewport?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-sim1-tab]");
    if (!tab) return;
    state.sim1GithubSelectedPr = parseInt(tab.getAttribute("data-sim1-tab"), 10);
    renderSim1();
  });

  // Sim 2
  el.btnSpawnWorkspaces?.addEventListener("click", () => {
    state.sim2Spawned = true;
    renderSim2();
  });
  el.btnResetWorkspaces?.addEventListener("click", () => {
    state.sim2Spawned = false;
    renderSim2();
  });

  // Step 3 Annotated card
  el.annotatedRegions.forEach((reg) => {
    reg.addEventListener("click", () => {
      const part = reg.getAttribute("data-part");
      selectAnnotatedPart(part);
    });
    reg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const part = reg.getAttribute("data-part");
        selectAnnotatedPart(part);
      }
    });
  });

  // Sim 3
  el.btnSim3Merge?.addEventListener("click", () => {
    state.sim3Attempted = true;
    el.btnSim3Merge.classList.add("is-active");
    el.btnSim3Reset.classList.remove("is-active");
    renderSim3();
  });
  el.btnSim3Reset?.addEventListener("click", () => {
    state.sim3Attempted = false;
    el.btnSim3Merge.classList.remove("is-active");
    el.btnSim3Reset.classList.add("is-active");
    renderSim3();
  });

  // Sim 4
  el.btnSim4Ship?.addEventListener("click", () => {
    if (state.sim4Status !== "idle") return;
    state.sim4Status = "shipping";
    renderSim4();

    setTimeout(() => {
      state.sim4Status = "landed";
      renderSim4();
    }, 900);
  });
  el.btnSim4Reset?.addEventListener("click", () => {
    state.sim4Status = "idle";
    renderSim4();
  });

  // Step 7 Quiz
  el.quizButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const repo = btn.getAttribute("data-quiz");
      handleQuizChoice(repo);
    });
  });

  // Keyboard navigation: Left/Right arrows
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowRight") {
      if (state.currentStep < state.totalSteps - 1) goToStep(state.currentStep + 1);
    } else if (e.key === "ArrowLeft") {
      if (state.currentStep > 0) goToStep(state.currentStep - 1);
    }
  });
}

/**
 * Initialization
 */
function init() {
  initEventListeners();
  renderSim1();
  renderSim2();
  renderSim3();
  renderSim4();
  loadRealProposals();
  goToStep(0);
}

// Bootstrap
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
