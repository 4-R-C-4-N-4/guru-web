"""
scripts/train_concept_head.py

Offline trainer for the query→concept head (ticket d6472704, rung 2). A tiny
one-vs-rest logistic layer over the FROZEN nomic query embedding — inference is a
single matmul, CPU-inline on the lean box, no model server.

Why (vs the raw-cosine semantic leg): on held-out queries the head roughly doubles
cosine's query→concept recall/precision (top-5 recall 0.30 vs 0.14, prec 0.43 vs
0.22), because cosine collapses on short/abstract queries while the head learns the
mapping from the golden query→provenance→concept labels.

Labels: each query's concepts = union of EXPRESSES targets over its provenance
chunks (data/concept-head-queries.jsonl + the corpus EXPRESSES edges). Query
embeddings via Ollama nomic (same model/path as the app, so query and head agree).

Emits src/data/concept-head.json: { dim, normalize, concepts[], w[][], b[] }.
guru-web loads it in src/lib/concept-head.ts. Re-run when the corpus/queries change.

Run:
  export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
  python scripts/train_concept_head.py                # train on all, report holdout
  python scripts/train_concept_head.py --eval-only    # just the holdout metrics
Needs: numpy, scikit-learn, and psql on PATH. (pip install numpy scikit-learn)
"""
import json, os, subprocess, sys, urllib.request
from collections import defaultdict
import numpy as np
from sklearn.linear_model import LogisticRegression

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUERIES = os.path.join(HERE, "data", "concept-head-queries.jsonl")
OUT = os.path.join(HERE, "src", "data", "concept-head.json")
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
DB = os.environ["DATABASE_URL"]
MIN_POS = 3  # a concept needs this many training queries to get its own head


def psql(sql: str) -> list[str]:
    out = subprocess.run(["psql", DB, "-tAc", f"SET search_path=public,corpus; {sql}"],
                         capture_output=True, text=True, check=True).stdout
    return [ln for ln in out.splitlines() if ln and ln != "SET"]


def embed(text: str) -> list[float]:
    body = json.dumps({"model": "nomic-embed-text:v1.5", "input": text}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["embeddings"][0]


def main():
    eval_only = "--eval-only" in sys.argv

    chunk2c = defaultdict(set)
    for ln in psql("SELECT source, target FROM edges WHERE edge_type='EXPRESSES'"):
        if "|" not in ln:  # psql -tA field separator is '|'
            continue
        ch, c = ln.split("|", 1)
        chunk2c[ch].add(c)

    queries, labels = [], []
    for ln in open(QUERIES):
        r = json.loads(ln)
        cs = set()
        for ch in (r.get("provenanceChunkIds") or []):
            cs |= chunk2c.get(ch, set())
        if cs:
            queries.append(r["query"]); labels.append(cs)
    print(f"{len(queries)} labeled queries")

    X = np.array([embed(q) for q in queries], dtype=np.float32)
    X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)  # normalize == inference

    concepts = sorted({c for cs in labels for c in cs})
    cidx = {c: i for i, c in enumerate(concepts)}
    Y = np.zeros((len(queries), len(concepts)), dtype=np.int8)
    for i, cs in enumerate(labels):
        for c in cs:
            Y[i, cidx[c]] = 1

    # Holdout metric (train on 80%, report top-k on 20%).
    rng = np.random.default_rng(0)
    perm = rng.permutation(len(queries)); k = int(len(queries) * 0.8)
    tr, te = perm[:k], perm[k:]

    def fit_cols(rows):
        W = np.zeros((len(concepts), X.shape[1]), dtype=np.float32)
        b = np.zeros(len(concepts), dtype=np.float32)
        kept = []
        for j in range(len(concepts)):
            if Y[rows, j].sum() < MIN_POS:
                continue
            clf = LogisticRegression(max_iter=1000, C=1.0, class_weight="balanced")
            clf.fit(X[rows], Y[rows, j])
            W[j] = clf.coef_[0]; b[j] = clf.intercept_[0]; kept.append(j)
        return W, b, kept

    Wte, bte, kept = fit_cols(tr)
    scores = X[te] @ Wte.T + bte
    scores[:, [j for j in range(len(concepts)) if j not in set(kept)]] = -1e9
    for kk in (5, 10):
        recs, precs = [], []
        for r_i, i in enumerate(te):
            true = set(np.where(Y[i] == 1)[0])
            if not true: continue
            top = set(np.argsort(-scores[r_i])[:kk])
            recs.append(len(true & top) / len(true)); precs.append(len(true & top) / kk)
        print(f"holdout top-{kk}: recall {np.mean(recs):.3f}  precision {np.mean(precs):.3f}")
    if eval_only:
        return

    # Final model: train on ALL queries.
    W, b, kept = fit_cols(np.arange(len(queries)))
    keep_set = set(kept)
    out_concepts = [concepts[j] for j in kept]
    artifact = {
        "dim": int(X.shape[1]),
        "normalize": True,           # L2-normalize the query embedding before applying
        "concepts": out_concepts,
        "w": [W[j].tolist() for j in kept],
        "b": [float(b[j]) for j in kept],
        "min_pos": MIN_POS,
        "n_train_queries": len(queries),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(artifact, f)
    print(f"wrote {OUT}: {len(out_concepts)} concept heads, dim {X.shape[1]}")


if __name__ == "__main__":
    main()
