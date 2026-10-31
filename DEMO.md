# 2-minute demo script

A live run takes 2–4 minutes, so Topic A and Topic B are started a few minutes **before** you present.
During the 2 minutes you show one live run (with your approval) and the two finished runs.
Everything on screen comes from real runs; nothing is pre-written.

## Prep (about 10 minutes before presenting)

1. **Terminal 1: backend, with the Topic B demo switch.** In the project folder:
   ```powershell
   $env:APOLLO_DEMO_FAIL_SUBQUESTION = "2"
   .venv\Scripts\python -m uvicorn api:app --port 8000
   ```
   If Groq's daily quota is used up, run these two lines first, in the same terminal:
   ```powershell
   $env:LLM_PROVIDER = "gemini"
   $env:GEMINI_MODEL = "gemini-flash-lite-latest"
   ```
2. **Terminal 2: frontend.**
   ```powershell
   cd frontend
   npm run dev
   ```
3. Open **http://localhost:5173** in browser **tab 1**. Click **Clear cache** (start from a clean cache).
4. **Tab 1, Topic A:** click **Demo: Topic A**, keep Max rounds **2**, HITL **off**, click **Start research**.
   Wait for "Finished: complete" (2–4 min). Check that the feed shows "Round 2".
5. **Tab 2, Topic B:** open http://localhost:5173 in a second tab. Click **Demo: Topic B**, set Max rounds **1**,
   HITL **off**, click **Start research**. Wait for "Finished: complete".
6. **Tab 3:** open http://localhost:5173 in a third tab and leave it empty. This is the live part.

Do not click Clear cache after step 4: it forgets finished runs.

## The 2 minutes

**0:00 · Tab 3: the idea (15 s)**
> "Apollo is a research team of three agents. Apollo plans, Athena searches the web, Hermes reviews for gaps
> and conflicts. The rule: every claim must cite a source we actually retrieved, and we check it."

Click **Demo: Topic A**, tick **Approve plan and gaps myself (HITL)**, click **Start research**.

**0:15 · Tab 3: human in the loop (30 s)**
When "Approve the research plan" appears:
> "Before anything is searched, I can check the plan."

Click **Edit**, change one sub-question (e.g. add "in Odia or Hindi" at the end), click **Save edits and continue**.
> "My edited question is what Athena searches now. You can see it in the feed."

Point at the feed: your edited question is listed under "Round 1: Athena searches 4 queries".
Tab 3 keeps running in the background; you come back to it at the end.

**0:45 · Tab 1: two rounds and a gap (25 s)**
> "Here is the same topic, finished. Hermes found a gap after round 1: district-level yield numbers. So
> Apollo ran a second round with Hermes' follow-up queries, then stopped at the 2-round limit, a rule
> enforced in code."

Point at "Hermes found … gap(s) in round 1", "Round 2", "Apollo stops: maximum number of rounds reached".

**1:10 · Tab 1: the report (25 s)**
Hover a citation such as **[S7]**:
> "Every claim links to its source. Hover shows the title and the text."

Click the **Verification** tab:
> "Each cited sentence was checked against the source's text: verified, partial, or not found."

Click **Sources**, then click **Download report.md** on the Report tab.

**1:35 · Tab 2: failure is handled (20 s)**
> "Here a search failed. We simulate an outage with a demo switch, because live search almost never returns
> nothing. The failure is an amber warning, the run still completes, and section 2 honestly says
> 'Not found in sources' instead of letting the AI guess."

Point at the amber "No results for …" and section 2 of the report.

**1:55 · Close (5 s)**
> "Plans you can steer, sources you can click, claims you can check."

After the demo, go back to tab 3. When "Approve Hermes' follow-up queries" appears (1–2 minutes after
the plan), click **Approve all** (or **Skip**) so the run can finish.

## If something goes wrong

- **Topic A stopped after round 1.** Hermes judged the sources sufficient, which happens rarely because the LLM is
  not deterministic. Start Topic A again in tab 1.
- **Amber "Rate limit … tokens per day".** The Groq quota is spent. Restart terminal 1 with the Gemini lines from step 1.
- **Amber "503 UNAVAILABLE".** Google's model is overloaded. Use `GEMINI_MODEL = "gemini-flash-lite-latest"`.
- **Tab 3 is still waiting at the end.** Approve or skip the follow-up queries. If nobody answers, the run
  auto-approves after 15 minutes, so it always ends.
