"""
Whisper's log-mel features as a small ONNX graph, so the phone needs no DSP code.

The graph reproduces transformers' WhisperFeatureExtractor exactly: 30 s of
16 kHz audio, reflect-padded by n_fft/2, a 400-point periodic-Hann STFT every
160 samples (written as one Conv whose kernels are the windowed DFT basis),
power, the 80 Slaney mel filters, log10 with a 1e-10 floor, the last frame
dropped, a dynamic range of 8 below the maximum, and (x + 4) / 4.

It is kept apart from the encoder and is never quantized: the int8 pass would
otherwise round the DFT basis and the filters.

Usage: build(mel_filters) -> onnx.ModelProto, where mel_filters is
WhisperFeatureExtractor().mel_filters, shape (201, 80).
"""
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

SAMPLE_RATE = 16000
N_SAMPLES = 480000  # 30 s
N_FFT = 400
HOP = 160
N_FREQ = N_FFT // 2 + 1  # 201
N_FRAMES = N_SAMPLES // HOP  # 3000


def build(mel_filters: np.ndarray) -> onnx.ModelProto:
    assert mel_filters.shape == (N_FREQ, 80), mel_filters.shape
    n = np.arange(N_FFT)
    window = 0.5 - 0.5 * np.cos(2 * np.pi * n / N_FFT)  # periodic Hann
    k = np.arange(N_FREQ)[:, None]
    angle = 2 * np.pi * k * n[None, :] / N_FFT
    real = (np.cos(angle) * window).astype(np.float32)
    imag = (-np.sin(angle) * window).astype(np.float32)
    basis = np.concatenate([real, imag], axis=0)[:, None, :]  # (402, 1, 400)

    inits = [
        numpy_helper.from_array(basis, 'dft_basis'),
        numpy_helper.from_array(mel_filters.T.astype(np.float32), 'mel_t'),  # (80, 201)
        numpy_helper.from_array(np.array([0, 0, N_FFT // 2, 0, 0, N_FFT // 2], np.int64), 'pads'),
        numpy_helper.from_array(np.array([1, 2, N_FREQ, -1], np.int64), 'pair_shape'),
        numpy_helper.from_array(np.array([0], np.int64), 'zero'),
        numpy_helper.from_array(np.array([N_FRAMES], np.int64), 'n_frames'),
        numpy_helper.from_array(np.array([2], np.int64), 'axis2'),
        numpy_helper.from_array(np.array([1], np.int64), 'axis1'),
        numpy_helper.from_array(np.array(1e-10, np.float32), 'floor'),
        numpy_helper.from_array(np.array(1 / np.log(10), np.float32), 'inv_ln10'),
        numpy_helper.from_array(np.array(8.0, np.float32), 'range'),
        numpy_helper.from_array(np.array(4.0, np.float32), 'four'),
        numpy_helper.from_array(np.array(0.25, np.float32), 'quarter'),
    ]
    nodes = [
        helper.make_node('Unsqueeze', ['pcm', 'axis1'], ['pcm3']),  # (1, 1, N)
        helper.make_node('Pad', ['pcm3', 'pads'], ['padded'], mode='reflect'),
        helper.make_node('Conv', ['padded', 'dft_basis'], ['spec'], strides=[HOP]),  # (1, 402, 3001)
        helper.make_node('Mul', ['spec', 'spec'], ['sq']),
        helper.make_node('Reshape', ['sq', 'pair_shape'], ['pairs']),  # (1, 2, 201, 3001)
        helper.make_node('ReduceSum', ['pairs', 'axis1'], ['power'], keepdims=0),  # (1, 201, 3001)
        helper.make_node('Slice', ['power', 'zero', 'n_frames', 'axis2'], ['power_t']),  # drop the last frame
        helper.make_node('MatMul', ['mel_t', 'power_t'], ['mel']),  # (1, 80, 3000)
        helper.make_node('Max', ['mel', 'floor'], ['mel_f']),
        helper.make_node('Log', ['mel_f'], ['ln']),
        helper.make_node('Mul', ['ln', 'inv_ln10'], ['log10']),
        helper.make_node('ReduceMax', ['log10'], ['peak'], keepdims=0),
        helper.make_node('Sub', ['peak', 'range'], ['low']),
        helper.make_node('Max', ['log10', 'low'], ['clamped']),
        helper.make_node('Add', ['clamped', 'four'], ['shifted']),
        helper.make_node('Mul', ['shifted', 'quarter'], ['features']),
    ]
    graph = helper.make_graph(
        nodes,
        'whisper_log_mel',
        [helper.make_tensor_value_info('pcm', TensorProto.FLOAT, [1, N_SAMPLES])],
        [helper.make_tensor_value_info('features', TensorProto.FLOAT, [1, 80, N_FRAMES])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model
