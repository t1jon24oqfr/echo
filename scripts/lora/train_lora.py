#!/usr/bin/env python3
"""
Per-character "Deep Persona" QLoRA trainer (rank 13). SCAFFOLD — runs on a single
24GB GPU (e.g. a 3090) via Unsloth. The adapter learns STYLE only (~100MB); facts
stay on the inference-time fact-sheet + grounding guard. Gate on >=500-1000 real
messages (below that a LoRA only matches prompting — see the README).

Usage:
    pip install "unsloth[colab-new]" trl peft bitsandbytes
    python scripts/lora/train_lora.py \
        --data /path/to/<corpus>.lora.jsonl \
        --persona <personaId> \
        --base unsloth/Qwen2.5-7B-Instruct-bnb-4bit \
        --out adapters/<personaId>

Data is the chat-format JSONL produced by `npm run lora:dataprep` (api/), i.e.
one object per line: {"messages":[{"role":"system",...},{"role":"user",...},
{"role":"assistant", "<the real persona reply>"}]}.

Base model: Qwen2.5-7B (already the chat family, good RU/UA) by default; use a
Gemma-2-9B or a Vikhr / Saiga-NeMo-12B base for strongly RU-dominant personas.
"""
import argparse
import json


def load_pairs(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="chat-format JSONL from npm run lora:dataprep")
    ap.add_argument("--persona", required=True, help="persona id (label only)")
    ap.add_argument("--base", default="unsloth/Qwen2.5-7B-Instruct-bnb-4bit")
    ap.add_argument("--out", default=None)
    ap.add_argument("--epochs", type=float, default=0)  # 0 => auto: scale inversely with data
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--alpha", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--max_seq", type=int, default=2048)
    args = ap.parse_args()
    out = args.out or f"adapters/{args.persona}"

    pairs = load_pairs(args.data)
    n = len(pairs)
    print(f"[lora] {n} training pairs for persona {args.persona}")
    if n < 200:
        print("[lora] WARNING: < 200 pairs. Style transfer will be weak; prefer the "
              "prompt+retrieval spine and gate this tier off for thin corpora.")
    # Fewer epochs when there's more data; more when sparse (avoid under/overfit).
    epochs = args.epochs or (5 if n < 400 else 4 if n < 1200 else 3)

    # --- Unsloth load (4-bit QLoRA) -----------------------------------------
    from unsloth import FastLanguageModel  # type: ignore
    from unsloth.chat_templates import get_chat_template  # type: ignore
    from datasets import Dataset  # type: ignore
    from trl import SFTTrainer  # type: ignore
    from transformers import TrainingArguments  # type: ignore

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base, max_seq_length=args.max_seq, load_in_4bit=True, dtype=None,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.rank, lora_alpha=args.alpha, lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth", random_state=42,
    )

    def fmt(ex):
        return {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False)}

    ds = Dataset.from_list(pairs).map(fmt)
    # Mix in ~7% general instruction data here against catastrophic forgetting of
    # UA/RU fluency + instruction-following (load your own held-out general set).

    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=ds,
        dataset_text_field="text", max_seq_length=args.max_seq,
        args=TrainingArguments(
            per_device_train_batch_size=2, gradient_accumulation_steps=4,
            warmup_steps=5, num_train_epochs=epochs, learning_rate=args.lr,
            fp16=True, logging_steps=10, optim="adamw_8bit",
            weight_decay=0.01, lr_scheduler_type="linear", seed=42, output_dir=out,
        ),
    )
    trainer.train()
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"[lora] adapter saved → {out} (epochs={epochs}, rank={args.rank})")
    print("[lora] serve via vLLM/TGI multi-LoRA or merge for an OpenAI-compatible "
          "endpoint; keep the fact-sheet + grounding guard at inference (style-only).")


if __name__ == "__main__":
    main()
