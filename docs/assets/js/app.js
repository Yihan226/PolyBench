(function () {
  const DATA = window.POLYBENCH_DATA || {};
  const STORAGE_KEY = "polybench-expert-session-v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value || 0);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function shortPath(path) {
    if (!path) return "";
    const parts = path.split("/");
    return parts.length > 3 ? `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}` : path;
  }

  function answerToString(answer) {
    if (Array.isArray(answer)) return answer.join(", ");
    if (answer && typeof answer === "object") return JSON.stringify(answer);
    return String(answer ?? "");
  }

  function normalizeAnswer(answer) {
    return answerToString(answer).trim().toLowerCase();
  }

  function formatGeneratedAt() {
    const target = $("#generatedAt");
    if (!target || !DATA.generatedAt) return;
    target.textContent = `Generated ${DATA.generatedAt.replace("T", " ").replace("Z", " UTC")}`;
  }

  function renderMath() {
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise().catch(() => {});
    }
  }

  function renderResultsPage() {
    formatGeneratedAt();
    renderSummaryMetrics();
    renderTopicDistribution();
    renderAbilityProfile();

    const state = { selected: 0 };
    const rows = DATA.leaderboard || [];
    renderLeaderboardRows(rows, state);
  }

  function renderSummaryMetrics() {
    const summary = DATA.summary || {};
    const metrics = [
      ["Questions", summary.totalQuestions],
      ["MCQ items", summary.mcqQuestions],
      ["Short-answer items", summary.qaQuestions],
      ["Topics", summary.topics],
    ];
    const container = $("#summaryMetrics");
    if (!container) return;
    container.innerHTML = metrics
      .map(
        ([label, value]) => `
          <article class="metric-card">
            <strong>${formatNumber(value)}</strong>
            <span>${escapeHtml(label)}</span>
          </article>
        `,
      )
      .join("");
  }

  function renderLeaderboardRows(rows, state) {
    const tbody = $("#leaderboardRows");
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-cell">No result runs yet.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row, index) => `
          <tr data-row-index="${index}" class="${index === state.selected ? "active-row" : ""}">
            <td><strong>${row.rank}</strong></td>
            <td>
              <strong>${escapeHtml(row.model)}</strong><br>
              <span class="muted">${escapeHtml(row.provider)}</span>
            </td>
            <td class="score-cell">
              <strong>${formatLeaderboardScore(row.overall)}</strong>
              <div class="score-track" aria-hidden="true"><span style="width:${leaderboardScoreWidth(row.overall)}%"></span></div>
            </td>
          </tr>
        `,
      )
      .join("");

    $$("tr[data-row-index]", tbody).forEach((row) => {
      row.addEventListener("click", () => {
        state.selected = Number(row.dataset.rowIndex);
        renderLeaderboardRows(rows, state);
      });
    });
  }

  function formatLeaderboardScore(score) {
    const value = Number(score || 0);
    if (value <= 1) return value.toFixed(3);
    return `${value.toFixed(1)}%`;
  }

  function leaderboardScoreWidth(score) {
    const value = Number(score || 0);
    return clamp(value <= 1 ? value * 100 : value, 0, 100);
  }

  function renderTopicDistribution() {
    const chart = $("#topicDistributionChart");
    const legend = $("#topicDistributionLegend");
    const distribution = DATA.topicDistribution || {};
    const topics = distribution.topics || [];
    const total = distribution.total || topics.reduce((sum, topic) => sum + (topic.count || 0), 0);
    if (!chart || !legend) return;
    if (!topics.length || !total) {
      chart.innerHTML = `<div class="empty-state">No topic distribution data.</div>`;
      legend.innerHTML = "";
      return;
    }

    const sortedTopics = topics
      .slice()
      .sort((a, b) => (b.percentOfTotal || 0) - (a.percentOfTotal || 0));

    chart.innerHTML = `
      ${buildTopicDonutSvg(sortedTopics, total)}
      <div id="subtopicPopover" class="subtopic-popover" hidden></div>
    `;
    bindSubtopicSegments(chart);

    legend.innerHTML = sortedTopics
      .map((topic, index) => {
        const color = topicColor(topic.name, index);
        return `
          <div class="legend-row">
            <span class="legend-swatch" style="background:${color}"></span>
            <span class="legend-topic">${escapeHtml(topic.name)}</span>
            <strong>${topic.percentOfTotal.toFixed(2)}%</strong>
            <span class="legend-count">${formatNumber(topic.count)} items</span>
          </div>
        `;
      })
      .join("");
  }

  function renderAbilityProfile() {
    const container = $("#abilityVisualization");
    const totalLabel = $("#abilityTotal");
    const abilityData = DATA.abilityPatterns || {};
    const patterns = (abilityData.patterns || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
    const total = abilityData.total || patterns.reduce((sum, pattern) => sum + (pattern.count || 0), 0);
    const abilities = (abilityData.abilities || buildAbilityTotals(patterns, total)).slice();

    if (!container) return;
    if (!patterns.length || !total) {
      container.innerHTML = `<div class="empty-state">No ability pattern data.</div>`;
      if (totalLabel) totalLabel.textContent = "";
      return;
    }

    if (totalLabel) totalLabel.textContent = `${formatNumber(total)} labeled items`;

    container.innerHTML = `
      <div class="ability-summary">
        ${abilities
          .map(
            (ability) => `
              <article class="ability-stat">
                <div
                  class="ability-dial"
                  style="--ability-color:${abilityColor(ability.name)}; --value:${clamp(ability.percentOfTotal || 0, 0, 100)}%;"
                >
                  <strong>${formatPercent(ability.percentOfTotal || 0)}</strong>
                </div>
                <span>${escapeHtml(abilityLabel(ability.name))}</span>
                <small>${formatNumber(ability.count)} items</small>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="ability-patterns">
        ${patterns
          .map((pattern) => {
            const percent = pattern.percentOfTotal || (pattern.count / total) * 100;
            return `
              <article class="ability-row">
                <div class="ability-row-top">
                  <div class="ability-chip-list">
                    ${(pattern.abilities || [])
                      .map(
                        (ability) => `
                          <span class="ability-chip" style="--ability-color:${abilityColor(ability)}">
                            ${escapeHtml(abilityLabel(ability))}
                          </span>
                        `,
                      )
                      .join("")}
                  </div>
                  <strong>${formatPercent(percent)}</strong>
                </div>
                <div class="ability-bar" aria-hidden="true">
                  <span style="width:${clamp(percent, 0, 100)}%; background:${abilityGradient(pattern.abilities || [])}"></span>
                </div>
                <small>${formatNumber(pattern.count)} items</small>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function buildAbilityTotals(patterns, total) {
    const counts = {};
    patterns.forEach((pattern) => {
      (pattern.abilities || []).forEach((ability) => {
        counts[ability] = (counts[ability] || 0) + (pattern.count || 0);
      });
    });
    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        percentOfTotal: total ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  function abilityLabel(ability) {
    const labels = {
      knowledge: "Knowledge",
      reasoning: "Reasoning",
      calculation: "Calculation",
    };
    return labels[ability] || ability;
  }

  function abilityColor(ability) {
    const colors = {
      knowledge: "#88A178",
      reasoning: "#738CB2",
      calculation: "#C6A36F",
    };
    return colors[ability] || "#8C8D86";
  }

  function abilityGradient(abilities) {
    if (!abilities.length) return "linear-gradient(90deg, #8C8D86, #8C8D86)";
    const stops = abilities.map((ability, index) => {
      const start = (index / abilities.length) * 100;
      const end = ((index + 1) / abilities.length) * 100;
      const color = abilityColor(ability);
      return `${color} ${start}% ${end}%`;
    });
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  function buildTopicDonutSvg(topics, total) {
    const cx = 180;
    const cy = 180;
    let topicStart = 0;
    let innerPaths = "";
    let outerPaths = "";

    topics.forEach((topic, topicIndex) => {
      const topicAngle = (topic.count / total) * 360;
      const topicEnd = topicStart + topicAngle;
      const color = topicColor(topic.name, topicIndex);
      innerPaths += ringPath(
        cx,
        cy,
        106,
        54,
        topicStart,
        topicEnd,
        color,
        `${topic.name}: ${topic.percentOfTotal.toFixed(2)}%`,
        "donut-segment inner-segment",
        {
          segment: "topic",
          topic: topic.name,
          count: topic.count,
          percent: topic.percentOfTotal.toFixed(2),
        },
      );

      let subStart = topicStart;
      const subtopics = topic.subtopics?.length
        ? topic.subtopics
            .slice()
            .sort((a, b) => (b.percentOfTotal || 0) - (a.percentOfTotal || 0))
        : [{ name: topic.name, count: topic.count, percentOfTotal: topic.percentOfTotal, percentWithinTopic: 100 }];
      subtopics.forEach((subtopic, subIndex) => {
        const subAngle = (subtopic.count / total) * 360;
        const subEnd = subStart + subAngle;
        const subColor = subtopicColor(color, subIndex, subtopics.length);
        const percent = typeof subtopic.percentOfTotal === "number"
          ? subtopic.percentOfTotal.toFixed(2)
          : ((subtopic.count / total) * 100).toFixed(2);
        outerPaths += ringPath(
          cx,
          cy,
          162,
          112,
          subStart,
          subEnd,
          subColor,
          `${topic.name} / ${subtopic.name}: ${percent}%`,
          "donut-segment outer-segment",
          {
            segment: "subtopic",
            topic: topic.name,
            subtopic: subtopic.name,
            count: subtopic.count,
            percent,
            within:
              typeof subtopic.percentWithinTopic === "number"
                ? subtopic.percentWithinTopic.toFixed(2)
                : "",
          },
        );
        subStart = subEnd;
      });

      topicStart = topicEnd;
    });

    return `
      <svg class="topic-donut-svg" viewBox="0 0 360 360" role="img" aria-label="Topic distribution, with main topics inside and subtopics outside">
        <circle cx="${cx}" cy="${cy}" r="166" fill="rgba(255,252,246,0.72)"></circle>
        ${outerPaths}
        ${innerPaths}
        <circle cx="${cx}" cy="${cy}" r="46" fill="rgba(255,252,246,0.96)"></circle>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-value">${formatNumber(total)}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-center-label">questions</text>
      </svg>
    `;
  }

  function ringPath(
    cx,
    cy,
    outerRadius,
    innerRadius,
    startAngle,
    endAngle,
    fill,
    label,
    className = "donut-segment",
    data = {},
  ) {
    if (endAngle - startAngle <= 0.01) return "";
    const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const d = [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");
    const dataAttrs = Object.entries(data)
      .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
      .join(" ");
    const interactiveAttrs = data.topic
      ? `role="button" tabindex="0" aria-label="${escapeHtml(label)}"`
      : "";
    return `<path class="${escapeHtml(className)}" d="${d}" fill="${fill}" stroke="rgba(255,252,246,0.86)" stroke-width="1.5" ${interactiveAttrs} ${dataAttrs}><title>${escapeHtml(label)}</title></path>`;
  }

  function bindSubtopicSegments(chart) {
    const popover = $("#subtopicPopover", chart);
    if (!popover) return;

    const show = (segment) => {
      $$(".donut-segment.active", chart).forEach((item) => item.classList.remove("active"));
      segment.classList.add("active");
      const percentWithinTopic = segment.dataset.within || "";
      const isTopic = segment.dataset.segment === "topic";
      popover.hidden = false;
      if (isTopic) {
        popover.innerHTML = `
          <span class="popover-kicker">Main topic</span>
          <span class="popover-label">${escapeHtml(segment.dataset.topic || "")}</span>
          <small>${formatNumber(Number(segment.dataset.count || 0))} items · ${escapeHtml(
            segment.dataset.percent || "0.00",
          )}% of all questions</small>
        `;
      } else {
        popover.innerHTML = `
          <span class="popover-kicker">${escapeHtml(segment.dataset.topic || "")}</span>
          <span class="popover-label">${escapeHtml(segment.dataset.subtopic || "")}</span>
          <small>${formatNumber(Number(segment.dataset.count || 0))} items · ${escapeHtml(segment.dataset.percent || "0.00")}% of all questions${
            percentWithinTopic
              ? ` · ${escapeHtml(percentWithinTopic)}% within topic`
              : ""
          }</small>
        `;
      }
    };

    $$(".donut-segment[data-topic]", chart).forEach((segment) => {
      segment.addEventListener("click", (event) => {
        event.stopPropagation();
        show(segment);
      });
      segment.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          show(segment);
        }
      });
    });

    chart.addEventListener("click", (event) => {
      if (event.target.closest(".donut-segment[data-topic]")) return;
      popover.hidden = true;
      $$(".donut-segment.active", chart).forEach((item) => item.classList.remove("active"));
    });
  }

  function polarToCartesian(cx, cy, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
    return {
      x: Number((cx + radius * Math.cos(angleInRadians)).toFixed(3)),
      y: Number((cy + radius * Math.sin(angleInRadians)).toFixed(3)),
    };
  }

  function topicColor(topicName, index) {
    const colorsByTopic = {
      "Basic Polymer Knowledge": "#6F9C9A",
      "Polymer Chain Structure and Polymer Morphology": "#738CB2",
      "Polymerization Synthesis": "#8586BD",
      "Polymerization Techniques": "#9784B5",
      "Polymer Properties": "#88A178",
      "Polymer Processing": "#C98376",
      "Thermodynamics of Binary Polymer Mixtures": "#B7839D",
      "Commercial Polymer": "#C6A36F",
      "Practical Application and Technology": "#78AAA4",
    };
    const fallback = [
      "#6F9C9A",
      "#738CB2",
      "#8586BD",
      "#9784B5",
      "#88A178",
      "#C98376",
      "#B7839D",
      "#C6A36F",
      "#78AAA4",
    ];
    return colorsByTopic[topicName] || fallback[index % fallback.length];
  }

  function subtopicColor(base, index, count) {
    const hsl = hexToHsl(base);
    const hueOffset = ((index % 7) - 3) * 1.8 + Math.floor(index / 7) * 2.4;
    const lightnessStep = count > 10 ? 2.9 : 4.2;
    const lightness = clamp(hsl.l + 4 + (index % 8) * lightnessStep, 50, 78);
    const saturation = clamp(hsl.s + 2 - (index % 4) * 2, 32, 56);
    const hue = (hsl.h + hueOffset + 360) % 360;
    return `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`;
  }

  function hexToHsl(hex) {
    const normalized = hex.replace("#", "");
    const value = parseInt(normalized, 16);
    let r = ((value >> 16) & 255) / 255;
    let g = ((value >> 8) & 255) / 255;
    let b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      if (max === g) h = (b - r) / d + 2;
      if (max === b) h = (r - g) / d + 4;
      h *= 60;
    }

    return { h, s: s * 100, l: l * 100 };
  }

  function renderExpertPage() {
    formatGeneratedAt();
    renderQuizBundleNote();

    const state = {
      questions: DATA.questions || [],
      filtered: [],
      currentIndex: 0,
      typeFilter: "all",
      topicFilter: "all",
      confidence: null,
      responses: loadResponses(),
      expertId: localStorage.getItem(`${STORAGE_KEY}:expert-id`) || "",
    };

    const expertId = $("#expertId");
    if (expertId) {
      expertId.value = state.expertId;
      expertId.addEventListener("input", () => {
        state.expertId = expertId.value.trim();
        localStorage.setItem(`${STORAGE_KEY}:expert-id`, state.expertId);
        updateExportPreview(state);
      });
    }

    populateTopicFilter();
    bindExpertEvents(state);
    applyExpertFilters(state);
  }

  function renderQuizBundleNote() {
    const note = $("#quizBundleNote");
    const bundle = DATA.questionBundle || {};
    if (!note) return;
    note.textContent = `${formatNumber(bundle.mcqQuestions || 0)} MCQ + ${formatNumber(
      bundle.qaQuestions || 0,
    )} QA example questions loaded`;
  }

  function loadResponses() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveResponses(responses) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(responses));
  }

  function populateTopicFilter() {
    const select = $("#topicFilter");
    if (!select) return;
    const topics = (DATA.topicDistribution?.topics || [])
      .map((topic) => topic.name)
      .filter(Boolean);
    const fallbackTopics = Array.from(new Set((DATA.questions || []).map((question) => question.topic).filter(Boolean)));
    const options = topics.length ? topics : fallbackTopics.sort((a, b) => a.localeCompare(b));
    select.innerHTML = [
      `<option value="all">All topics</option>`,
      ...options.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`),
    ].join("");
  }

  function bindExpertEvents(state) {
    $$(".segment[data-type-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".segment[data-type-filter]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        state.typeFilter = button.dataset.typeFilter;
        state.currentIndex = 0;
        applyExpertFilters(state);
      });
    });

    $("#topicFilter")?.addEventListener("change", (event) => {
      state.topicFilter = event.target.value;
      state.currentIndex = 0;
      applyExpertFilters(state);
    });

    $("#prevQuestion")?.addEventListener("click", () => {
      state.currentIndex = Math.max(0, state.currentIndex - 1);
      renderCurrentQuestion(state);
    });

    $("#nextQuestion")?.addEventListener("click", () => {
      state.currentIndex = Math.min(state.filtered.length - 1, state.currentIndex + 1);
      renderCurrentQuestion(state);
    });

    $("#shuffleQuestions")?.addEventListener("click", () => {
      state.filtered = shuffle(state.filtered);
      state.currentIndex = 0;
      renderCurrentQuestion(state);
    });

    $("#resetSession")?.addEventListener("click", () => {
      if (!confirm("Reset local expert answers?")) return;
      state.responses = {};
      saveResponses(state.responses);
      renderCurrentQuestion(state);
      updateSessionStats(state);
      updateExportPreview(state);
    });

    $("#saveAnswer")?.addEventListener("click", () => saveCurrentAnswer(state));
    $("#revealAnswer")?.addEventListener("click", () => revealCurrentAnswer(state));
    $("#exportAnswers")?.addEventListener("click", () => downloadExport(state));
    $("#copyExport")?.addEventListener("click", () => copyExport(state));
    $("#closeImageLightbox")?.addEventListener("click", closeImageLightbox);
    $("#closeImageLightboxButton")?.addEventListener("click", closeImageLightbox);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeImageLightbox();
    });

    $$("#confidenceButtons button").forEach((button) => {
      button.addEventListener("click", () => {
        state.confidence = Number(button.dataset.confidence);
        $$("#confidenceButtons button").forEach((item) => item.classList.toggle("active", item === button));
        $(".confidence-row")?.classList.remove("needs-attention");
        $("#answerKey").hidden = true;
        updateRevealButton(state);
      });
    });
  }

  function applyExpertFilters(state) {
    state.filtered = state.questions.filter((question) => {
      const typeMatch = state.typeFilter === "all" || question.type === state.typeFilter;
      const topicMatch = state.topicFilter === "all" || question.topic === state.topicFilter;
      return typeMatch && topicMatch;
    });
    state.currentIndex = Math.min(state.currentIndex, Math.max(0, state.filtered.length - 1));
    renderCurrentQuestion(state);
    updateSessionStats(state);
    updateExportPreview(state);
  }

  function renderCurrentQuestion(state) {
    const question = state.filtered[state.currentIndex];
    const empty = !question;
    $("#questionCounter").textContent = empty
      ? "No matching questions"
      : `Question ${state.currentIndex + 1} of ${state.filtered.length}`;
    $("#questionProgress").style.width = empty
      ? "0%"
      : `${((state.currentIndex + 1) / state.filtered.length) * 100}%`;

    if (empty) {
      $("#questionType").textContent = "";
      $("#questionDataset").textContent = "";
      $("#questionTopic").textContent = "";
      $("#questionText").innerHTML = "No matching questions.";
      $("#questionImages").innerHTML = "";
      $("#optionList").innerHTML = "";
      $("#freeAnswerWrap").hidden = true;
      $("#answerKey").hidden = true;
      updateRevealButton(state);
      return;
    }

    const saved = state.responses[question.id] || {};
    state.confidence = saved.confidence || null;

    $("#questionType").textContent = question.type;
    $("#questionDataset").textContent = question.datasetLabel;
    $("#questionTopic").textContent = question.topic;
    $("#questionText").innerHTML = formatQuestionText(question.question);

    renderQuestionImages(question);
    renderAnswerInput(question, saved, state);

    $("#expertNotes").value = saved.notes || "";
    $$("#confidenceButtons button").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.confidence) === state.confidence);
    });

    const answerKey = $("#answerKey");
    answerKey.hidden = true;
    answerKey.innerHTML = "";
    updateRevealButton(state);
    renderMath();
  }

  function formatQuestionText(text) {
    return escapeHtml(text).replace(/&lt;image_(\d+)&gt;/g, '<span class="pill soft">image_$1</span>');
  }

  function renderQuestionImages(question) {
    const container = $("#questionImages");
    container.innerHTML = (question.images || [])
      .map(
        (image) => `
          <figure>
            <button class="image-zoom-button" type="button" data-src="${escapeHtml(image.src)}" data-caption="${escapeHtml(image.label)}">
              <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.label)} for ${escapeHtml(question.topic)}" loading="lazy">
            </button>
            <figcaption>${escapeHtml(image.label)}</figcaption>
          </figure>
        `,
      )
      .join("");
    $$(".image-zoom-button", container).forEach((button) => {
      button.addEventListener("click", () => {
        openImageLightbox(button.dataset.src, button.dataset.caption || "Question image");
      });
    });
  }

  function openImageLightbox(src, caption) {
    const lightbox = $("#imageLightbox");
    const image = $("#imageLightboxImg");
    const label = $("#imageLightboxCaption");
    if (!lightbox || !image || !label || !src) return;
    image.src = src;
    image.alt = caption;
    label.textContent = caption;
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeImageLightbox() {
    const lightbox = $("#imageLightbox");
    const image = $("#imageLightboxImg");
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    if (image) image.src = "";
    document.body.classList.remove("lightbox-open");
  }

  function renderAnswerInput(question, saved, state) {
    const optionList = $("#optionList");
    const freeAnswerWrap = $("#freeAnswerWrap");
    const freeAnswer = $("#freeAnswer");

    if (question.type === "MCQ") {
      freeAnswerWrap.hidden = true;
      const options = Object.entries(question.options || {});
      optionList.hidden = false;
      optionList.innerHTML = options
        .map(
          ([letter, text]) => `
            <button class="option-button ${saved.answer === letter ? "selected" : ""}" type="button" data-option="${escapeHtml(letter)}">
              <span class="option-letter">${escapeHtml(letter)}</span>
              <span>${escapeHtml(text)}</span>
            </button>
          `,
        )
        .join("");
      $$(".option-button", optionList).forEach((button) => {
        button.addEventListener("click", () => {
          $$(".option-button", optionList).forEach((item) => item.classList.remove("selected"));
          button.classList.add("selected");
          button.dataset.pending = "true";
          $("#answerKey").hidden = true;
          updateRevealButton(state);
        });
      });
    } else {
      optionList.hidden = true;
      optionList.innerHTML = "";
      freeAnswerWrap.hidden = false;
      freeAnswer.value = saved.answer || "";
      freeAnswer.oninput = () => {
        $("#answerKey").hidden = true;
        updateRevealButton(state);
      };
    }
  }

  function saveCurrentAnswer(state) {
    const question = state.filtered[state.currentIndex];
    if (!question) return;

    let answer = "";
    if (question.type === "MCQ") {
      const selected = $(".option-button.selected");
      answer = selected?.dataset.option || "";
    } else {
      answer = $("#freeAnswer").value.trim();
    }

    if (!answer) {
      flashButton($("#saveAnswer"), "Add answer");
      return;
    }

    if (state.confidence === null) {
      $(".confidence-row")?.classList.add("needs-attention");
      flashButton($("#saveAnswer"), "Pick confidence");
      return;
    }

    const correct =
      question.type === "MCQ" && answer
        ? normalizeAnswer(answer) === normalizeAnswer(question.answer)
        : null;

    state.responses[question.id] = {
      uuid: question.id,
      dataset: question.dataset,
      type: question.type,
      topic: question.topic,
      answer,
      confidence: state.confidence,
      notes: $("#expertNotes").value.trim(),
      correct,
      savedAt: new Date().toISOString(),
    };
    saveResponses(state.responses);
    updateSessionStats(state);
    updateExportPreview(state);
    updateRevealButton(state);
    flashButton($("#saveAnswer"), "Saved");
  }

  function revealCurrentAnswer(state) {
    const question = state.filtered[state.currentIndex];
    if (!question || !canRevealAnswer(state)) return;
    const key = $("#answerKey");
    key.hidden = false;
    const explanation = question.longAnswer
      ? `<p>${formatQuestionText(question.longAnswer)}</p>`
      : "";
    key.innerHTML = `
      <strong>Answer key: ${escapeHtml(answerToString(question.answer))}</strong>
      ${explanation}
    `;
    renderMath();
  }

  function currentAnswerValue(question) {
    if (!question) return "";
    if (question.type === "MCQ") {
      return $(".option-button.selected")?.dataset.option || "";
    }
    return $("#freeAnswer")?.value.trim() || "";
  }

  function canRevealAnswer(state) {
    const question = state.filtered[state.currentIndex];
    if (!question) return false;
    const saved = state.responses[question.id];
    if (!saved || !saved.answer || saved.confidence === null || saved.confidence === undefined) return false;
    return (
      normalizeAnswer(currentAnswerValue(question)) === normalizeAnswer(saved.answer)
      && Number(state.confidence) === Number(saved.confidence)
    );
  }

  function updateRevealButton(state) {
    const button = $("#revealAnswer");
    if (!button) return;
    const canReveal = canRevealAnswer(state);
    button.hidden = !canReveal;
    button.disabled = !canReveal;
    button.title = canReveal ? "" : "Save an answer and confidence score for this question before revealing the key.";
    if (!canReveal) {
      const key = $("#answerKey");
      if (key) key.hidden = true;
    }
  }

  function updateSessionStats(state) {
    const responses = Object.values(state.responses);
    $("#answeredCount").textContent = formatNumber(responses.length);
    const mcq = responses.filter((response) => response.type === "MCQ" && response.answer);
    const correct = mcq.filter((response) => response.correct).length;
    $("#mcqScore").textContent = mcq.length ? `${Math.round((correct / mcq.length) * 100)}%` : "0%";
  }

  function exportPayload(state) {
    return {
      benchmark: "PolyBench",
      expertId: state.expertId || "anonymous-reviewer",
      exportedAt: new Date().toISOString(),
      responses: Object.values(state.responses).sort((a, b) => a.uuid.localeCompare(b.uuid)),
    };
  }

  function updateExportPreview(state) {
    const preview = $("#exportPreview");
    if (!preview) return;
    preview.textContent = JSON.stringify(exportPayload(state), null, 2);
  }

  function downloadExport(state) {
    const payload = JSON.stringify(exportPayload(state), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `polybench-expert-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function copyExport(state) {
    const payload = JSON.stringify(exportPayload(state), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      flashButton($("#copyExport"), "Copied");
    } catch {
      $("#exportPreview").focus();
    }
  }

  function flashButton(button, label) {
    if (!button) return;
    const oldLabel = button.textContent;
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = oldLabel;
    }, 900);
  }

  function shuffle(items) {
    const next = items.slice();
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    }
    return next;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (!DATA.summary) {
      document.body.insertAdjacentHTML(
        "afterbegin",
        '<div class="empty-state">PolyBench data bundle was not loaded.</div>',
      );
      return;
    }
    if (page === "results") renderResultsPage();
    if (page === "experts") renderExpertPage();
  });
})();
