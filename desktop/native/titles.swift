// notes-titles: "Generate title" with Apple's on-device model (Apple Intelligence, macOS 26 or
// later). Nothing leaves the Mac. desktop/ai.cjs runs it:
//   notes-titles --check      prints "available", or why it isn't
//   notes-titles < note.txt   prints a title for the note
import Foundation
import FoundationModels

let instructions = """
You give notes their titles. Read the whole note, work out its main subject and purpose, and write the title a thoughtful person would give it.
Rules:
- 2 to 6 words, Title Case.
- Name the specific subject (the place, project, person, event or topic), not generic words like "Details", "Notes", "Information", "List" or "Thoughts".
- Summarise the whole note, not just its first sentence.
- Reply with the title only: no quotes, no ending punctuation, no emoji.
Examples:
Note: Flights leave Friday at 9. Hotel near the river in Porto. Book the port wine cellar tour. Pack light.
Title: Weekend Trip to Porto
Note: milk, eggs, spinach, rice, coffee filters, dish soap
Title: Grocery List
Note: Q3 numbers came in under target. Marketing wants more budget. Sam will draft a hiring plan by Monday.
Title: Q3 Results and Next Steps
Note: Chapter 7 drags. Cut the dinner scene and move the letter from Ana's mother earlier.
Title: Chapter 7 Revisions
"""

func reason(_ a: SystemLanguageModel.Availability) -> String {
  switch a {
  case .available: return "available"
  case .unavailable(.deviceNotEligible): return "This Mac can’t run Apple Intelligence."
  case .unavailable(.appleIntelligenceNotEnabled): return "Turn on Apple Intelligence in System Settings."
  case .unavailable(.modelNotReady): return "Apple Intelligence is still getting ready."
  default: return "Apple Intelligence isn’t available."
  }
}

let model = SystemLanguageModel.default
if CommandLine.arguments.contains("--check") {
  print(reason(model.availability))
  exit(0)
}
guard case .available = model.availability else {
  FileHandle.standardError.write(reason(model.availability).data(using: .utf8)!)
  exit(2)
}
// The model reads about 4,000 tokens at a time: a long note is cut to its first part.
let text = String(String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self).prefix(6000))
do {
  let session = LanguageModelSession(instructions: instructions)
  let r = try await session.respond(to: "Note: \(text)\nTitle:", options: GenerationOptions(temperature: 0.3))
  print(r.content)
} catch {
  FileHandle.standardError.write("Apple Intelligence couldn’t title this note.".data(using: .utf8)!)
  exit(1)
}
