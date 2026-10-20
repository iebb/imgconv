resz.im local image models

These model files are served from the same static site as the application.
Inference runs in the user's browser. Images are not sent to the model authors,
Hugging Face, GitHub, or any inference API. See manifest.json for pinned download
URLs, SHA-256 hashes, tensor shapes, and preprocessing.

U²-Net small (u2netp.onnx)
Architecture and pretrained model: Xuebin Qin et al., U²-Net: Going Deeper with
Nested U-Structure for Salient Object Detection. Apache License 2.0.
Project: https://github.com/xuebinqin/U-2-Net
ONNX conversion distributed by rembg, Daniel Gatis et al. (MIT).
Download: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
License texts: LICENSE-u2net.txt and LICENSE-rembg.txt.
This small saliency model works best when one clear foreground subject stands
apart from the background. It does not guarantee perfect edges or subject choice.

Real-ESRGAN general x4 v3 (realesr-general-x4v3.onnx)
Copyright (c) 2021 Xintao Wang. BSD 3-Clause License.
Architecture and pretrained model: https://github.com/xinntao/Real-ESRGAN
ONNX export mirror: https://huggingface.co/Heliosoph/realesrgan-onnx
Pinned mirror commit: 488e5dda07333179f229a6205d92135eea4c25e9
License text: LICENSE-realesrgan.txt.
The network reconstructs an estimated larger image; details are predictions and
are not guaranteed to match the original scene.
