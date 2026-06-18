# Per-character LoRA — "Deep Persona" (rank 13)

The premium tier: a per-person QLoRA adapter that learns the persona's **style**
(not facts) on top of the open-weight chat base. ~90% of "that's them" comes from
the Phase-0 prompt+retrieval spine; this roughly doubles believability on idiolect
(IMPersona 25%→44%) but **only with enough data and only for style**.

## Hard gates (do not skip)

- **Data floor: ≥ 500–1000 real persona messages.** Below it a LoRA only matches
  prompting (IMPersona's 500-example ≈ best prompt-only) — it's the wrong product
  for most grieving users. `npm run lora:dataprep` warns below `--min` (default 500).
- **Style only.** Every biographical claim still goes through the inference-time
  fact-sheet (`card.facts` + `kind='fact'` memories) and the grounding guard. A
  higher-fidelity voice that confabulates is *worse* for a grieving user.
- **Paid tier**, gated in product; ~$5 of compute + a GPU lane per persona.

## Pipeline

```
# 1) data-prep (in api/) — chat-format JSONL of (context → real reply) pairs
npm run lora:dataprep <corpus>.json --author "Name" --out <corpus>.lora.jsonl --min 500

# 2) train on a 24GB GPU (~1–3h, ~100MB adapter)
pip install "unsloth[colab-new]" trl peft bitsandbytes datasets
python scripts/lora/train_lora.py --data <corpus>.lora.jsonl --persona <id> \
    --base unsloth/Qwen2.5-7B-Instruct-bnb-4bit --out adapters/<id>

# 3) (optional) DPO from feedback once PreferencePair data accumulates
#    same PEFT stack; gate on the Layer-1 style-distance harness to prove it moved
#    idiolect WITHOUT raising hallucination.

# 4) evaluate BEFORE shipping the adapter
npm run replay:persona <corpus>.json --author "Name" --out gen.txt   # generate with the adapter-served model
npm run eval:persona  <corpus>.json --author "Name" --generated gen.txt
```

## Base model by language

| Persona language | Base |
|---|---|
| UA / mixed / surzhyk (default) | `Qwen2.5-7B-Instruct` (already the chat family) or `Gemma-2-9B-IT` |
| Strongly RU-dominant | `Vikhr` / `Saiga-NeMo-12B` |

## Hyperparameters (defaults in `train_lora.py`)

rank 8 · alpha 16 · dropout 0.05 · LR 1e-4 · 3–5 epochs (auto-scaled inversely to
data) · 4-bit QLoRA · mix ~7% general instruction data against catastrophic
forgetting of UA/RU fluency + instruction-following.

## Serving

Multi-LoRA serving (vLLM / TGI) so one base hosts many ~100MB adapters hot-swappable
per persona, or merge for an OpenAI-compatible endpoint reachable from the same
`OPENAI_BASE_URL` path the app already uses. Keep the fact-sheet + grounding guard
at inference regardless of the adapter.

> Status: **scaffold** — data-prep CLI runs today; the GPU training run is not part
> of the app deploy. Wire the adapter id onto the persona + route `CHAT_MODEL` to
> the served adapter when the tier ships.
