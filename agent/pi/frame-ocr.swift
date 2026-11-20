// Native OCR reads only the adapter's already-captured PNG; no network or media files.
import Foundation
import Vision
import ImageIO
if CommandLine.arguments.count != 2 { exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(3) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: image)
do {
    try handler.perform([request])
    let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return ["text": candidate.string, "confidence": candidate.confidence]
    }
    let data = try JSONSerialization.data(withJSONObject: ["engine": "apple-vision-v1", "lines": lines], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
} catch { exit(4) }
