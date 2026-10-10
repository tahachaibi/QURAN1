"""
Export Tarteel's Quran speech model for the phone (CI only: needs torch and
the Hugging Face hub).

    python scripts/quran-model/export.py --model tarteel-ai/whisper-tiny-ar-quran --out out/quran-model

Writes:
  features.onnx  30 s of 16 kHz audio -> Whisper log-mel (fp32; features.py)
  encoder.onnx   log-mel -> encoder states            (int8 weights)
  decoder.onnx   tokens + encoder states -> the two best next tokens at each
                 position from `from_pos` on, special tokens and the model's
                 suppressed tokens already excluded     (int8 weights)
  tokens.bin     every token id's bytes, for turning ids into text
  config.json    the prompt, end-of-text id, licence and revision

The licence is read from the hub and must allow redistribution, or nothing
is written.
"""
import argparse
import json
import os
import struct
import sys
import urllib.request

import numpy as np
import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import WhisperFeatureExtractor, WhisperForConditionalGeneration, WhisperTokenizer

sys.path.insert(0, os.path.dirname(__file__))
import features  # noqa: E402

ALLOWED_LICENSES = {'apache-2.0', 'mit'}


def licence_of(model_id: str) -> tuple[str, str]:
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{model_id}') as r:
        info = json.load(r)
    card = info.get('cardData') or {}
    licence = card.get('license') or next(
        (t.split(':', 1)[1] for t in info.get('tags', []) if t.startswith('license:')), ''
    )
    return str(licence).lower(), info.get('sha', '')


class Encoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder = model.model.encoder

    def forward(self, input_features):
        return self.encoder(input_features=input_features, return_dict=True).last_hidden_state


class Decoder(torch.nn.Module):
    """
    No key/value cache: every call runs the whole token sequence. The app calls
    it with the previous pass's words as a draft and keeps the part the model
    agrees with, so a pass costs a few calls, not one per token.
    """

    def __init__(self, model, n_keep: int, suppress: list[int]):
        super().__init__()
        self.decoder = model.model.decoder
        self.proj = model.proj_out
        self.n_keep = n_keep
        bias = torch.zeros(n_keep)
        for t in suppress:
            if t < n_keep:
                bias[t] = -1e9
        self.register_buffer('bias', bias)

    def forward(self, input_ids, encoder_hidden_states, from_pos):
        h = self.decoder(
            input_ids=input_ids, encoder_hidden_states=encoder_hidden_states, use_cache=False, return_dict=True
        ).last_hidden_state
        positions = torch.arange(from_pos, h.shape[1], dtype=torch.int64)
        h = h.index_select(1, positions)
        # text tokens and end-of-text only: every id from eot + 1 on is special
        logits = self.proj(h)[..., : self.n_keep] + self.bias
        return torch.topk(logits, 2, dim=-1).indices


def byte_decoder() -> dict[str, int]:
    """GPT-2's byte-level alphabet, inverted: the character each byte is written as -> the byte."""
    bs = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(bs, cs)}


def write_tokens(tokenizer, eot: int, path: str) -> None:
    dec = byte_decoder()
    with open(path, 'wb') as f:
        f.write(struct.pack('<I', eot))
        for i in range(eot):
            piece = tokenizer.convert_ids_to_tokens(i)
            raw = bytes(dec[ch] for ch in piece) if piece is not None else b''
            f.write(struct.pack('<H', len(raw)))
            f.write(raw)


def quantize(src: str, dst: str) -> None:
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul', 'Gather'])
    os.remove(src)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='tarteel-ai/whisper-tiny-ar-quran')
    ap.add_argument('--out', default='out/quran-model')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    licence, sha = licence_of(args.model)
    print(f'{args.model} @ {sha}: licence {licence!r}')
    if licence not in ALLOWED_LICENSES:
        sys.exit(f'licence {licence!r} does not allow shipping the model in the app; stopping')

    model = WhisperForConditionalGeneration.from_pretrained(args.model, revision=sha, attn_implementation='eager').eval()
    tokenizer = WhisperTokenizer.from_pretrained(args.model, revision=sha)
    fe = WhisperFeatureExtractor.from_pretrained(args.model, revision=sha)

    ids = tokenizer.convert_tokens_to_ids
    eot = ids('<|endoftext|>')
    prompt = [ids('<|startoftranscript|>'), ids('<|ar|>'), ids('<|transcribe|>'), ids('<|notimestamps|>')]
    gen = model.generation_config
    suppress = list(getattr(gen, 'suppress_tokens', None) or [])
    begin_suppress = list(getattr(gen, 'begin_suppress_tokens', None) or [220, eot])
    n_keep = eot + 1
    print('prompt', prompt, 'eot', eot, 'suppressed', len(suppress), 'begin-suppressed', begin_suppress)

    onnx.save(features.build(fe.mel_filters), os.path.join(args.out, 'features.onnx'))

    feats = torch.from_numpy(fe(np.zeros(16000, np.float32), sampling_rate=16000, return_tensors='np').input_features)
    enc = Encoder(model)
    tmp = os.path.join(args.out, 'encoder.fp32.onnx')
    with torch.no_grad():
        torch.onnx.export(
            enc, (feats,), tmp, input_names=['input_features'], output_names=['encoder_hidden_states'],
            opset_version=17, do_constant_folding=True,
        )
        states = enc(feats)
    quantize(tmp, os.path.join(args.out, 'encoder.onnx'))

    dec = Decoder(model, n_keep, suppress)
    tokens = torch.tensor([prompt + [100, 200]], dtype=torch.int64)
    tmp = os.path.join(args.out, 'decoder.fp32.onnx')
    with torch.no_grad():
        torch.onnx.export(
            dec, (tokens, states, torch.tensor(0, dtype=torch.int64)), tmp,
            input_names=['input_ids', 'encoder_hidden_states', 'from_pos'], output_names=['top2'],
            dynamic_axes={'input_ids': {1: 'tokens'}, 'top2': {1: 'positions'}},
            opset_version=17, do_constant_folding=True,
        )
    quantize(tmp, os.path.join(args.out, 'decoder.onnx'))

    write_tokens(tokenizer, eot, os.path.join(args.out, 'tokens.bin'))
    with open(os.path.join(args.out, 'config.json'), 'w') as f:
        json.dump(
            {
                'model': args.model,
                'revision': sha,
                'license': licence,
                'prompt': prompt,
                'eot': eot,
                'beginSuppress': begin_suppress,
                'sampleRate': features.SAMPLE_RATE,
                'nSamples': features.N_SAMPLES,
            },
            f,
            indent=1,
        )
    for name in sorted(os.listdir(args.out)):
        print(f'{name:16} {os.path.getsize(os.path.join(args.out, name)) / 1e6:7.1f} MB')


if __name__ == '__main__':
    main()
