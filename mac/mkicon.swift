// icon.jpg (or any image) → AppIcon.icns with macOS Big Sur+ proportions: artwork clipped to a rounded square at ~80% of the canvas, soft shadow.
import AppKit
let src = NSImage(contentsOfFile: CommandLine.arguments[1])!
let out = CommandLine.arguments[2]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (base, scale) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
  let px = base * scale
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  let s = CGFloat(px), inset = s * 0.1, side = s - inset * 2
  let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.3); shadow.shadowBlurRadius = s * 0.02; shadow.shadowOffset = NSSize(width: 0, height: -s * 0.01); shadow.set()
  let r = NSRect(x: inset, y: inset + s * 0.005, width: side, height: side)
  let shape = NSBezierPath(roundedRect: r, xRadius: side * 0.225, yRadius: side * 0.225)
  NSColor.black.setFill(); shape.fill()          // casts the shadow
  NSShadow().set(); shape.addClip()
  src.draw(in: r)
  NSGraphicsContext.restoreGraphicsState()
  let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name)"))
}
