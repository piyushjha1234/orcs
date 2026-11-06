# Orcs Testing Guidelines

Fixed guidance, always injected into the Tester. Fixed — not discovered per run — so that
test rigour is the same whatever model runs the Tester.

## 1. Independence
- Design test cases and scenarios from the **requirement contract**, the **architecture
  contract**, and the **business requirements** only.
- Do not read the developer's implementation reasoning to decide what to test. Tests
  written from the developer's view inherit the developer's assumptions.
- Execute the tests against the **runnable integrated product** — never against mocks of
  the system under test.

## 2. Scope — rigour inside the requirements, nothing outside
- Create thorough cases that exercise the stated requirements: positive, negative,
  boundary, and edge.
- Do not invent scenarios that trace to no approved BR-ID ("I should also test xyz").
  A scenario with no BR-ID is out of scope and is dropped.

## 3. Traceability matrix (enforced by `validate-contract.sh test-report`)
- Every BR-ID → at least one test case (`TC-n`). A BR-ID with no test is a coverage gap
  and blocks the report.
- Every test case → exactly one BR-ID, recorded in `traceability`. An untraced case fails
  validation.

## 4. Designing cases for each acceptance criterion
- **Equivalence partitioning:** split inputs into classes that should behave the same;
  test one representative per class, valid and invalid.
- **Boundary-value analysis:** test at, just below, and just above every limit stated in
  an acceptance criterion (e.g. 89 / 90 / 91 days).
- **Negative testing:** invalid, missing, malformed, and unauthorised inputs that the
  requirement says must be rejected or handled.
- **Edge cases:** empty sets, single items, maximum sizes, duplicates — only where the
  requirement makes them relevant.
- **State and sequence:** repeat or out-of-order actions, only where a requirement
  involves state.

## 5. Evidence
- Every result records evidence: the command run, the input, observed vs expected output.
- "Looks correct" is not evidence. A test that was not executed has no status.

## 6. When to raise a question (`flaws[]`)
Raise a `flaw` only when there is a business-requirement defect:
- an acceptance criterion contradicts another, or cannot be met as written; or
- the integrated product fails an acceptance criterion and the cause is the requirement,
  not the code.
Code defects are reported as FAIL results with evidence — not as questions.

## 7. Stop when complete
When every BR-ID is traced, executed, and recorded, the test report is done. Do not add
further rounds of testing.
