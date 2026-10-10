"""
Check the exported model on real recitations before it goes into an APK (CI).

    python scripts/quran-model/verify.py --dir out/quran-model

For a few ayahs by two reciters (everyayah.com) it:
  1. checks features.onnx against transformers' own feature extractor;
  2. transcribes with the exported int8 model exactly as the phone does
     (QuranAsr below is what QuranAsr.kt ports): every half second of audio
     a pass over the utterance so far, reusing the last pass's tokens as a
     draft, then a final pass;
  3. checks the streamed result is identical to plain greedy decoding (the
     draft must only ever save work, never change the answer);
  4. compares with the original model in torch (transformers' generate), and
     with the mushaf text, on the consonant skeleton;
  5. reports how long a pass takes here, for scale (a phone is slower).

Exits non-zero if the transcripts are not usable.
"""
import argparse
import json
import os
import re
import statistics
import struct
import subprocess
import sys
import time
import urllib.request

import numpy as np
import onnxruntime as ort

AYAHS = [(1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (2, 2), (2, 3), (2, 5), (112, 1), (112, 2), (112, 3), (112, 4)]
RECITERS = ['Alafasy_128kbps', 'Husary_128kbps']
STEP_S = 0.5
MAX_NEW = 200


class QuranAsr:
    def __init__(self, folder: str):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        self.features = ort.InferenceSession(os.path.join(folder, 'features.onnx'), opts)
        self.encoder = ort.InferenceSession(os.path.join(folder, 'encoder.onnx'), opts)
        self.decoder = ort.InferenceSession(os.path.join(folder, 'decoder.onnx'), opts)
        with open(os.path.join(folder, 'config.json')) as f:
            self.cfg = json.load(f)
        with open(os.path.join(folder, 'tokens.bin'), 'rb') as f:
            (eot,) = struct.unpack('<I', f.read(4))
            self.pieces = []
            for _ in range(eot):
                (n,) = struct.unpack('<H', f.read(2))
                self.pieces.append(f.read(n))
        self.eot = self.cfg['eot']
        self.prompt = self.cfg['prompt']
        self.begin_suppress = set(self.cfg['beginSuppress'])

    def encode(self, pcm: np.ndarray) -> np.ndarray:
        padded = np.zeros((1, self.cfg['nSamples']), np.float32)
        n = min(len(pcm), padded.shape[1])
        padded[0, :n] = pcm[:n]
        feats = self.features.run(None, {'pcm': padded})[0]
        return self.encoder.run(None, {'input_features': feats})[0]

    def decode(self, states: np.ndarray, draft: list[int]) -> tuple[list[int], int]:
        """Greedy decoding, using `draft` (the last pass's tokens) where the model agrees with it."""
        p = len(self.prompt)
        tokens = self.prompt + [t for t in draft if t < self.eot]
        frm = p - 1
        calls = 0
        while len(tokens) - p < MAX_NEW:
            top2 = self.decoder.run(
                None,
                {
                    'input_ids': np.array([tokens], np.int64),
                    'encoder_hidden_states': states,
                    'from_pos': np.array(frm, np.int64),
                },
            )[0][0]
            calls += 1
            for j, pos in enumerate(range(frm, len(tokens))):
                first, second = int(top2[j][0]), int(top2[j][1])
                pred = second if pos == p - 1 and first in self.begin_suppress else first
                if pos == len(tokens) - 1:
                    if pred == self.eot:
                        return tokens[p:], calls
                    tokens.append(pred)
                    frm = len(tokens) - 1
                    break
                if pred != tokens[pos + 1]:
                    if pred == self.eot:
                        return tokens[p : pos + 1], calls
                    tokens = tokens[: pos + 1] + [pred]
                    frm = len(tokens) - 1
                    break
            # a loop the model has fallen into: the same four tokens again
            text = tokens[p:]
            if len(text) >= 12 and text[-4:] == text[-8:-4] == text[-12:-8]:
                return text[:-8], calls
        return tokens[p:], calls

    def text(self, tokens: list[int]) -> str:
        return b''.join(self.pieces[t] for t in tokens if t < self.eot).decode('utf-8', errors='replace').strip()


MARKS = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')


def skeleton(s: str) -> str:
    """Consonants only: no harakat, no long-vowel letters, one hamza-less alif shape."""
    s = MARKS.sub('', s)
    s = re.sub('[أإآٱ]', 'ا', s).replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي').replace('ء', '')
    return re.sub('[اوي\\s]', '', s)


def cer(a: str, b: str) -> float:
    if not b:
        return 0.0 if not a else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / len(b)


def audio(reciter: str, surah: int, ayah: int, cache: str) -> np.ndarray:
    os.makedirs(cache, exist_ok=True)
    mp3 = os.path.join(cache, f'{reciter}-{surah:03d}{ayah:03d}.mp3')
    if not os.path.exists(mp3):
        urllib.request.urlretrieve(f'https://everyayah.com/data/{reciter}/{surah:03d}{ayah:03d}.mp3', mp3)
    raw = subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-i', mp3, '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def ayah_text(surah: int, ayah: int) -> str:
    here = os.path.dirname(__file__)
    with open(os.path.join(here, '..', '..', 'src', 'assets', 'quran-data.json'), encoding='utf-8') as f:
        data = json.load(f)
    return data[surah - 1][5][ayah - 1][4]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='out/quran-model')
    ap.add_argument('--cache', default='out/audio')
    args = ap.parse_args()

    asr = QuranAsr(args.dir)
    cfg = asr.cfg
    print(f"model {cfg['model']} @ {cfg['revision']} licence {cfg['license']}")

    import torch
    from transformers import WhisperFeatureExtractor, WhisperForConditionalGeneration, WhisperProcessor

    fe = WhisperFeatureExtractor.from_pretrained(cfg['model'], revision=cfg['revision'])
    ref_model = WhisperForConditionalGeneration.from_pretrained(cfg['model'], revision=cfg['revision']).eval()
    processor = WhisperProcessor.from_pretrained(cfg['model'], revision=cfg['revision'])

    enc_ms, dec_ms, calls_per_pass, vs_text, vs_ref = [], [], [], [], []
    failures = 0
    for reciter in RECITERS:
        for surah, ayah in AYAHS:
            pcm = audio(reciter, surah, ayah, args.cache)
            secs = len(pcm) / 16000
            if secs > 29:
                print(f'skip {surah}:{ayah} ({secs:.0f} s)')
                continue

            padded = np.zeros((1, cfg['nSamples']), np.float32)
            padded[0, : len(pcm)] = pcm
            ours = asr.features.run(None, {'pcm': padded})[0]
            ref_feats = fe(pcm, sampling_rate=16000, return_tensors='np').input_features
            diff = float(np.abs(ours - ref_feats).max())
            if diff > 1e-3:
                print(f'FEATURES DIFFER on {surah}:{ayah}: {diff}')
                failures += 1

            # streamed, as on the phone
            draft: list[int] = []
            t = STEP_S
            while True:
                n = int(min(t, secs) * 16000)
                t0 = time.perf_counter()
                states = asr.encode(pcm[:n])
                t1 = time.perf_counter()
                draft, calls = asr.decode(states, draft)
                t2 = time.perf_counter()
                enc_ms.append((t1 - t0) * 1000)
                dec_ms.append((t2 - t1) * 1000)
                calls_per_pass.append(calls)
                if t >= secs:
                    break
                t += STEP_S
            streamed = asr.text(draft)

            plain, _ = asr.decode(asr.encode(pcm), [])
            if plain != draft:
                print(f'DRAFT CHANGED THE ANSWER on {surah}:{ayah}:\n  plain    {asr.text(plain)}\n  streamed {streamed}')
                failures += 1

            with torch.no_grad():
                gen = ref_model.generate(
                    torch.from_numpy(ref_feats), language='ar', task='transcribe', max_new_tokens=MAX_NEW
                )
            reference = processor.batch_decode(gen, skip_special_tokens=True)[0].strip()

            truth = ayah_text(surah, ayah)
            e_text = cer(skeleton(streamed), skeleton(truth))
            e_ref = cer(skeleton(streamed), skeleton(reference))
            vs_text.append(e_text)
            vs_ref.append(e_ref)
            print(f'{reciter[:7]} {surah}:{ayah} {secs:4.1f}s  vs mushaf {e_text:.2f}  vs torch {e_ref:.2f}')
            print(f'   ours   {streamed}')
            if e_ref > 0:
                print(f'   torch  {reference}')

    print()
    print(f'skeleton error vs mushaf: mean {statistics.mean(vs_text):.3f}  max {max(vs_text):.3f}')
    print(f'skeleton error vs torch fp32: mean {statistics.mean(vs_ref):.3f}  max {max(vs_ref):.3f}')
    print(
        f'per pass here: encoder median {statistics.median(enc_ms):.0f} ms, '
        f'decoder median {statistics.median(dec_ms):.0f} ms (p90 {sorted(dec_ms)[int(len(dec_ms) * 0.9)]:.0f}), '
        f'{statistics.mean(calls_per_pass):.1f} decoder calls per pass'
    )
    if failures or statistics.mean(vs_text) > 0.25 or statistics.mean(vs_ref) > 0.15:
        sys.exit('the exported model is not good enough to ship')


if __name__ == '__main__':
    main()
