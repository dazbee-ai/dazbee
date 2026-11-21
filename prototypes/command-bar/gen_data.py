"""PROTOTYPE, never merged. Writes the command bar's train, validation and test sets.

Every request is written here by hand as a template, filled with slot values (the thing selected,
sizes, colours, brand roles, directions) and varied by spelling, politeness and typos. No model
wrote any of it. Each template belongs to one split only, so the test set holds phrasings the
model never trained on; some objects, wrappers and colour words are held out of training too.

Out: data/{train,calib,validation,test}.queries.jsonl (one request, its gold call and category)
and data/{train,validation}.needle.jsonl (Needle's training rows for both turns). The calib split's
phrasings are kept out of the LoRA training: the confidence head learns from the tuned model's
mistakes on them, then validation sets its threshold, and test is only scored.
"""
import hashlib
import json
import os
import random
import re

from tools import ACTIONS, AREAS, AREA_OF, TOOL

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data")

# ---------------------------------------------------------------- the things a request names
TEXT_OBJ = ["the headline", "the title", "the text", "this text", "the subheading", "the tagline",
            "the body copy", "the price", "the caption", "the button text", "the CTA", "it", "this",
            "the heading", "the offer text", "the copy", "the name", "the date"]
TEXT_OBJ_TEST = ["the quote", "the disclaimer", "the strapline", "the label"]
ANY_OBJ = ["this", "it", "the logo", "the image", "the photo", "the shape", "the box", "the button",
           "the circle", "the icon", "the headline", "the selection", "the rectangle", "the title",
           "the product shot", "the background shape", "that", "the frame's picture", "the line",
           "the star", "the card"]
ANY_OBJ_TEST = ["the badge", "the sticker", "the arrow", "the banner shape"]
MANY_OBJ = ["these", "them", "the selected layers", "these layers", "the icons", "the buttons",
            "these shapes", "everything selected", "all of them", "the logos", "these three",
            "these two", "the boxes", "the cards"]
MANY_OBJ_TEST = ["the photos", "these items", "the badges"]

PREFIX = ["", "", "", "", "please ", "can you ", "could you ", "pls ", "i want to ", "let's ",
          "hey, ", "ok ", "now ", "quickly ", "go ahead and ", "i'd like to "]
SUFFIX = ["", "", "", "", " please", " thanks", "!", " now", " pls", " for me", " thx", "."]

COLOURS = {"red": ["red"], "orange": ["orange"], "yellow": ["yellow"], "green": ["green"],
           "teal": ["teal"], "blue": ["blue"], "navy": ["navy", "navy blue"], "purple": ["purple"],
           "pink": ["pink"], "brown": ["brown"], "black": ["black"], "white": ["white"],
           "grey": ["grey", "gray"], "gold": ["gold", "golden"]}
COLOURS_TEST = {"purple": ["violet"]}

ROLES = {"primary": ["primary", "main"], "secondary": ["secondary"], "accent": ["accent"],
         "background": ["background"], "text": ["text"]}

# ---------------------------------------------------------------- the templates, by call
# Each entry: (tool, arguments, object kind, [templates]). {o} is the thing selected; {n} a number;
# {c} a colour word; {r} a brand role word; {h} a hex code; {d} a direction word. A slot's
# argument value comes from the slot (see fill()). Kinds: text, any, many, none.
I = []


def add(tool, args, kind, *templates):
    I.append((tool, args, kind, list(templates)))


# text_style -------------------------------------------------------------------
add("set_text_weight", {"weight": "bold"}, "text",
    "make {o} bold", "bold {o}", "{o} in bold", "embolden {o}", "make {o} bolder", "put {o} in bold",
    "i want {o} bold", "set {o} to bold", "change {o} to a bold weight", "bold face {o}",
    "make the font of {o} bold", "thicker letters on {o}", "can {o} be bold", "bold it",
    "give {o} a bold weight", "use bold for {o}", "bolden {o}", "make {o} stand out in bold")
add("set_text_weight", {"weight": "regular"}, "text",
    "unbold {o}", "remove the bold from {o}", "make {o} regular weight", "set {o} to normal weight",
    "take the bold off {o}", "make {o} regular", "back to regular weight", "normal font weight on {o}",
    "un-bold {o}", "turn off bold on {o}", "regular weight for {o}", "drop the bold on {o}")
add("set_text_weight", {"weight": "light"}, "text",
    "make {o} light", "lighter weight for {o}", "use a light weight on {o}", "set {o} in light",
    "make the font of {o} lighter", "light font weight on {o}", "change {o} to light weight",
    "a lighter weight for {o}")
add("set_text_weight", {"weight": "thin"}, "text",
    "make {o} thin", "thin weight for {o}", "set {o} to the thinnest weight", "hairline weight for {o}",
    "use the thin weight on {o}", "change {o} to a thin font weight")
add("set_text_weight", {"weight": "medium"}, "text",
    "medium weight for {o}", "make {o} medium weight", "set {o} to medium weight",
    "change the weight of {o} to medium", "use medium on {o}", "{o} in medium weight")
add("set_text_weight", {"weight": "semibold"}, "text",
    "semibold {o}", "make {o} semi-bold", "semi bold please", "set {o} to semibold",
    "demibold {o}", "make {o} semibold", "change {o} to semi bold weight")
add("set_text_weight", {"weight": "black"}, "text",
    "make {o} black weight", "heaviest weight for {o}", "set {o} to black weight", "ultra bold {o}",
    "use the black weight on {o}", "make {o} as heavy as possible", "the heaviest font weight on {o}")

add("set_text_case", {"case": "uppercase"}, "text",
    "all caps", "make {o} all caps", "uppercase {o}", "capitalise every letter of {o}",
    "put {o} in capitals", "caps lock {o}", "{o} in uppercase", "make {o} upper case",
    "CAPS please", "make every letter of {o} a capital", "set {o} in all caps", "{o} all caps",
    "all caps on {o}", "uppercase it", "change {o} to uppercase", "capitals for {o}",
    "make {o} shouty caps", "put {o} in block capitals")
add("set_text_case", {"case": "lowercase"}, "text",
    "lowercase {o}", "make {o} all lowercase", "small letters for {o}", "no capitals in {o}",
    "put {o} in lower case", "make everything lowercase", "change {o} to lowercase",
    "all lowercase on {o}", "lowercase it", "set {o} in lower case letters")
add("set_text_case", {"case": "title case"}, "text",
    "title case {o}", "make {o} title case", "capitalise each word of {o}",
    "capitalize the first letter of every word", "headline case for {o}", "put {o} in title case",
    "change {o} to title case", "upper case the first letter of each word in {o}",
    "title-case it")
add("set_text_case", {"case": "normal"}, "text",
    "remove the all caps from {o}", "turn off caps on {o}", "back to normal case",
    "set {o} back to the case it was typed in", "normal case please", "no text transform on {o}",
    "undo the uppercase on {o}", "switch {o} back to normal case", "remove the uppercase from {o}",
    "stop {o} being all caps", "clear the text case on {o}")

for style, on_words, off_words in [
    ("italic",
     ["italicize {o}", "italicise {o}", "make {o} italic", "put {o} in italics", "slant {o}",
      "italic please", "{o} in italic", "add italics to {o}", "italics on {o}", "make it italic",
      "set {o} in italic", "turn on italic for {o}"],
     ["remove the italics from {o}", "unitalicize {o}", "make {o} upright", "no italics on {o}",
      "turn off italic", "take the italic off {o}", "un-italic {o}", "make {o} non italic",
      "drop the italics on {o}", "remove italic"]),
    ("underline",
     ["underline {o}", "add an underline to {o}", "put a line under {o}", "make {o} underlined",
      "underline it", "give {o} an underline", "underlined text for {o}", "turn on underline",
      "can you underline {o}", "underline the words in {o}"],
     ["remove the underline from {o}", "take the underline off {o}", "no underline on {o}",
      "un-underline {o}", "turn off underline", "get rid of the underline on {o}",
      "delete the underline under {o}", "lose the underline"]),
    ("strikethrough",
     ["strike through {o}", "cross out {o}", "add a strikethrough to {o}", "put a line through {o}",
      "strikethrough {o}", "strike out {o}", "cross {o} out", "make {o} crossed out",
      "turn on strikethrough", "add strike through to {o}"],
     ["remove the strikethrough from {o}", "uncross {o}", "take the line through {o} off",
      "no strikethrough on {o}", "turn off strikethrough", "remove the strike through",
      "un-strike {o}", "get rid of the crossed out line on {o}"]),
]:
    add("style_text", {"style": style, "on": True}, "text", *on_words)
    add("style_text", {"style": style, "on": False}, "text", *off_words)

add("align_text", {"align": "left"}, "text",
    "left align the text", "left-align the text in {o}", "align the text of {o} to the left",
    "make the text flush left", "text align left", "align the lines of {o} left",
    "set the text alignment of {o} to left", "left-justify the copy", "align the words left in {o}",
    "make the paragraph left aligned", "text alignment left please")
add("align_text", {"align": "center"}, "text",
    "center the text", "centre the text in {o}", "center align the text",
    "make the lines of {o} centered", "text align center", "set the text alignment of {o} to center",
    "center the words inside {o}", "centre-align the copy", "make the paragraph centered",
    "center the lines of text", "text alignment centre please")
add("align_text", {"align": "right"}, "text",
    "right align the text", "right-align the text in {o}", "flush right text",
    "align the words in {o} to the right", "text align right", "set the text alignment of {o} to right",
    "make the paragraph right aligned", "align the lines of {o} right", "right-justify the copy")
add("align_text", {"align": "justify"}, "text",
    "justify the text in {o}", "justify the text", "make the text justified",
    "full justify the paragraph", "set the text alignment of {o} to justified",
    "justify the copy", "make the lines of {o} justified", "text align justify",
    "block justify the paragraph")

add("change_spacing", {"spacing": "letter spacing", "direction": "more"}, "text",
    "increase the letter spacing", "more letter spacing on {o}", "spread the letters out",
    "loosen the tracking", "add tracking to {o}", "wider letter spacing", "space out the letters of {o}",
    "more space between the letters", "open up the tracking on {o}", "increase tracking")
add("change_spacing", {"spacing": "letter spacing", "direction": "less"}, "text",
    "tighten the letter spacing", "reduce tracking on {o}", "less space between letters",
    "squeeze the letters of {o} together", "tighter kerning on {o}", "decrease the letter spacing",
    "reduce the letter spacing of {o}", "tighten the tracking", "less letter spacing")
add("change_spacing", {"spacing": "line spacing", "direction": "more"}, "text",
    "more line spacing", "increase the line height of {o}", "add leading to {o}",
    "more space between lines", "open up the line spacing", "loosen the leading",
    "increase the line spacing on {o}", "more room between the lines of {o}", "bigger line height")
add("change_spacing", {"spacing": "line spacing", "direction": "less"}, "text",
    "tighten the line spacing", "reduce the line height", "less leading on {o}",
    "bring the lines of {o} closer together", "less space between the lines", "decrease the leading",
    "tighter line spacing on {o}", "smaller line height", "reduce the line spacing of {o}")

# size_and_shape ---------------------------------------------------------------
add("resize", {"direction": "bigger"}, "any",
    "make {o} bigger", "bigger", "enlarge {o}", "scale up {o}", "make {o} larger",
    "increase the size of {o}", "blow up {o}", "{o} needs to be bigger", "make {o} a bit bigger",
    "grow {o}", "size up {o}", "increase the font size of {o}", "make {o} huge", "embiggen {o}",
    "make the text larger", "{o} is too small", "can {o} be larger", "scale {o} up",
    "make {o} a little larger", "make the headline bigger")
add("resize", {"direction": "bigger", "percent": "{n}"}, "any",
    "make {o} {n}% bigger", "scale {o} up by {n}%", "enlarge {o} by {n} percent",
    "increase the size of {o} by {n}%", "grow {o} {n}%", "make {o} {n} percent larger",
    "scale up {o} {n}%", "bump up the size of {o} by {n}%", "make {o} bigger by {n}%")
add("resize", {"direction": "smaller"}, "any",
    "make {o} smaller", "shrink {o}", "scale down {o}", "reduce the size of {o}",
    "make {o} a little smaller", "decrease the font size of {o}", "{o} is too big", "make {o} tinier",
    "downsize {o}", "smaller", "make {o} less big", "make {o} a bit smaller", "scale {o} down",
    "make the text smaller", "can {o} be smaller", "{o} is way too large", "make the logo smaller")
add("resize", {"direction": "smaller", "percent": "{n}"}, "any",
    "make {o} {n}% smaller", "shrink {o} by {n}%", "scale {o} down {n} percent",
    "reduce {o} by {n}%", "make {o} {n} percent smaller", "scale down {o} {n}%",
    "decrease the size of {o} by {n}%", "shrink {o} {n} percent")
add("set_font_size", {"size": "{n}"}, "text",
    "set the font size to {n}", "font size {n}", "make the text {n}px", "make the text {n} pt",
    "change the font size of {o} to {n}", "{n}pt text please", "size {n} font for {o}",
    "make {o} size {n}", "{o} at {n} points", "type size {n}", "set {o} to {n} px",
    "font size of {o} to {n}", "make the font {n}", "change {o} to font size {n}",
    "{n} px font", "i want the font size at {n}")
add("rotate", {"degrees": "{n}"}, "any",
    "rotate {o} {n} degrees", "turn {o} {n}°", "rotate {o} by {n}", "spin {o} {n} degrees",
    "tilt {o} {n} degrees", "rotate {o} {n} degrees clockwise", "rotate it {n}",
    "turn {o} {n} degrees to the right", "give {o} a {n} degree rotation", "rotate {o} {n}°",
    "turn {o} clockwise by {n} degrees", "spin {o} {n}° clockwise")
add("rotate", {"degrees": "-{n}"}, "any",
    "rotate {o} {n} degrees counterclockwise", "rotate {o} {n} degrees anticlockwise",
    "turn {o} {n} degrees to the left", "rotate {o} -{n} degrees", "tilt {o} {n}° to the left",
    "spin {o} anticlockwise by {n} degrees", "turn {o} counter-clockwise {n} degrees",
    "rotate {o} left by {n} degrees")
add("flip", {"axis": "horizontal"}, "any",
    "flip {o} horizontally", "mirror {o}", "flip {o} left to right", "mirror image {o}",
    "flip it sideways", "make {o} face the other way", "flip {o} horizontal", "mirror {o} horizontally",
    "flip horizontally", "horizontal flip on {o}", "reverse {o} left to right")
add("flip", {"axis": "vertical"}, "any",
    "flip {o} vertically", "flip {o} upside down", "turn {o} upside down", "mirror {o} vertically",
    "flip top to bottom", "flip {o} vertical", "vertical flip on {o}", "make {o} upside down",
    "flip vertically", "flip {o} over top to bottom")
add("round_corners", {"radius": "{n}"}, "any",
    "round the corners of {o} to {n}px", "corner radius {n}", "give {o} {n}px rounded corners",
    "set the radius of {o} to {n}", "make the corners {n} pixels round", "{n}px radius on {o}",
    "round {o} by {n}", "set the corner radius of {o} to {n} px", "{n} px corners please",
    "rounded corners {n}")
add("round_corners", {"radius": 16}, "any",
    "round the corners", "give {o} rounded corners", "make the corners of {o} rounded",
    "soften the corners of {o}", "round off {o}", "rounded corners please", "round {o}'s corners",
    "add rounded corners to {o}", "make {o} have round corners")
add("round_corners", {"radius": 0}, "any",
    "make the corners square", "square corners on {o}", "remove the rounded corners from {o}",
    "sharp corners please", "make the corners of {o} sharp", "no corner radius on {o}",
    "take the rounding off {o}", "square off the corners")

# colour_and_brand -------------------------------------------------------------
add("use_brand_colour", {"role": "{r}"}, "any",
    "use the brand's {r} colour", "make {o} the {r} colour", "apply the brand {r} colour to {o}",
    "{r} brand colour on {o}", "colour {o} with our {r} colour", "switch {o} to the brand {r}",
    "use our {r} color", "make it brand {r}", "change {o} to the kit's {r} colour",
    "fill {o} with the {r} brand colour", "give {o} our {r} colour", "{o} in the brand {r} color",
    "brand {r} for {o}", "set {o} to the {r} colour from the brand kit", "paint {o} brand {r}")
add("set_colour", {"colour": "{c}"}, "any",
    "make {o} {c}", "colour {o} {c}", "change {o} to {c}", "{c} please", "turn {o} {c}",
    "paint {o} {c}", "fill {o} with {c}", "make the text {c}", "i want {o} in {c}",
    "change the colour of {o} to {c}", "recolour {o} {c}", "{o} should be {c}", "make it {c}",
    "change the fill to {c}", "set the colour to {c}", "{c} for {o}", "can {o} be {c}",
    "{o} in {c}", "switch {o} to {c}")
add("set_hex_colour", {"hex": "{h}"}, "any",
    "make {o} {h}", "colour {o} {h}", "change the fill to {h}", "use {h} for {o}",
    "set the colour of {o} to {h}", "{h} please", "hex {h}", "change the text colour to {h}",
    "fill {o} with {h}", "{o} should be {h}", "recolour {o} to {h}", "make it {h}",
    "switch {o} to {h}", "colour code {h} on {o}")
add("set_opacity", {"percent": "{n}", "measure": "opacity"}, "any",
    "set the opacity of {o} to {n}%", "{n}% opacity", "make {o} {n} percent opaque", "opacity {n}",
    "change {o}'s opacity to {n}%", "{o} at {n}% opacity", "opacity of {n} percent for {o}",
    "make the opacity {n}%", "set {o} to {n} opacity", "turn the opacity down to {n}%",
    "make {o} {n}% opaque")
add("set_opacity", {"percent": "{n}", "measure": "transparency"}, "any",
    "make {o} {n}% transparent", "{n}% transparency on {o}", "set transparency to {n} percent",
    "make {o} {n}% see-through", "{o} {n} percent transparent", "transparency {n}%",
    "give {o} {n}% transparency", "set the transparency of {o} to {n}%", "{n}% see through")
add("use_brand_font", {"font": "heading"}, "text",
    "use the brand heading font", "set {o} in our heading font",
    "change the font of {o} to the brand's heading font", "apply the heading font",
    "heading font on {o}", "switch {o} to the brand heading typeface", "use our heading font for {o}",
    "make {o} the heading font", "the kit's heading font please", "give {o} the brand's heading font")
add("use_brand_font", {"font": "body"}, "text",
    "use the body font", "set {o} in the brand body font", "switch {o} to our body typeface",
    "brand body font please", "apply the body font to {o}", "change the font of {o} to the body font",
    "use our body font for {o}", "make {o} the brand's body font", "body font on {o}",
    "the kit's body typeface for {o}")

# arrange ----------------------------------------------------------------------
for edge, words in [("left", ["left"]), ("right", ["right"]), ("top", ["top"]), ("bottom", ["bottom"])]:
    add("align_layers", {"edge": edge}, "many",
        f"align {{o}} {edge}", f"align {{o}} to the {edge}", f"line up {{o}} on the {edge}",
        f"line up their {edge} edges", f"align the layers {edge}", f"snap {{o}} to the {edge} edge",
        f"push {{o}} to the {edge} of the frame", f"{edge} align {{o}}", f"align to the {edge}",
        f"line {{o}} up along the {edge}", f"align {{o}} by their {edge} edges",
        f"move {{o}} to the {edge} edge", f"make {{o}} {edge} aligned")
add("align_layers", {"edge": "center"}, "many",
    "center {o}", "centre {o}", "align {o} to the center", "center {o} horizontally",
    "line up the centers of {o}", "align {o} centre", "center align {o}", "put {o} in the center",
    "center it on the page", "align {o} along the center line", "centre {o} horizontally",
    "line up {o} down the middle line horizontally")
add("align_layers", {"edge": "middle"}, "many",
    "center {o} vertically", "align {o} to the middle", "vertically center {o}", "middle align {o}",
    "align {o} middle", "centre {o} vertically", "line up the middles of {o}",
    "vertically centre {o}", "align the vertical centers of {o}", "put {o} in the vertical middle")
add("distribute_layers", {"direction": "horizontally"}, "many",
    "distribute {o} horizontally", "space {o} out evenly across", "spread {o} evenly side by side",
    "even out the horizontal gaps between {o}", "distribute horizontally", "equal spacing across for {o}",
    "space {o} evenly horizontally", "make the gaps between {o} even left to right",
    "horizontally distribute {o}", "spread {o} out horizontally")
add("distribute_layers", {"direction": "vertically"}, "many",
    "distribute {o} vertically", "space {o} out evenly down the page", "spread {o} evenly top to bottom",
    "even out the vertical gaps between {o}", "distribute vertically", "equal spacing down for {o}",
    "space {o} evenly vertically", "make the gaps between {o} even top to bottom",
    "vertically distribute {o}", "spread {o} out vertically")
add("change_layer_order", {"to": "forward"}, "any",
    "bring {o} forward", "move {o} up a layer", "bring {o} forward one step", "one layer up",
    "bring {o} up one level", "move {o} forward in the stack", "bring forward", "raise {o} one layer",
    "bring {o} forward a bit in the layer order")
add("change_layer_order", {"to": "backward"}, "any",
    "send {o} backward", "move {o} down a layer", "send {o} back one step", "one layer down",
    "send {o} down one level", "move {o} backward in the stack", "send backward", "lower {o} one layer",
    "push {o} back one layer")
add("change_layer_order", {"to": "front"}, "any",
    "bring {o} to the front", "put {o} on top", "move {o} above everything", "bring to front",
    "put {o} in front of everything", "bring {o} all the way forward", "{o} on top of everything",
    "move {o} to the very top of the stack", "bring {o} to the top layer")
add("change_layer_order", {"to": "back"}, "any",
    "send {o} to the back", "put {o} behind everything", "move {o} to the bottom of the stack",
    "send to back", "send {o} all the way back", "put {o} at the very back", "{o} behind everything",
    "move {o} to the bottom layer", "push {o} to the back")
add("move_layers", {"direction": "{d}", "pixels": "{n}"}, "any",
    "move {o} {n}px {d}", "nudge {o} {d} by {n} pixels", "shift {o} {n} pixels {d}",
    "push {o} {d} {n}px", "move {o} {d} {n}", "move {o} {d} by {n} px", "{n}px {d}",
    "nudge {o} {n} pixels {d}", "shift {o} {d} {n}px", "move {o} {n} pixels to the {d}")
add("move_layers", {"direction": "{d}", "pixels": 10}, "any",
    "nudge {o} {d}", "move {o} {d} a bit", "shift {o} {d}", "move it {d}", "nudge it {d} a little",
    "move {o} slightly {d}", "push {o} {d} a touch", "scoot {o} {d}", "move {o} a little to the {d}")

# layers -----------------------------------------------------------------------
add("duplicate_layers", {}, "any",
    "duplicate {o}", "copy {o}", "make a copy of {o}", "clone {o}", "dupe {o}", "make a duplicate",
    "duplicate", "copy and paste {o}", "i need two of {o}", "another one of {o}", "duplicate it",
    "make another {o}", "repeat {o}", "create a copy of {o}", "double {o}", "can you duplicate {o}")
add("delete_layers", {}, "any",
    "delete {o}", "remove {o}", "get rid of {o}", "trash {o}", "bin {o}", "erase {o}",
    "throw {o} away", "{o} can go", "take {o} out", "delete", "remove it", "kill {o}", "lose {o}",
    "ditch {o}", "delete that", "scrap {o}")
add("group_layers", {"action": "group"}, "many",
    "group {o}", "group these", "group {o} together", "put {o} in a group", "make a group of {o}",
    "combine {o} into a group", "group", "group them up", "wrap {o} in a group", "make {o} one group")
add("group_layers", {"action": "ungroup"}, "any",
    "ungroup {o}", "break apart the group", "split up the group", "take {o} out of the group",
    "ungroup these", "ungroup", "break up {o}", "dissolve the group", "un-group {o}",
    "release {o} from its group")
add("lock_layers", {"action": "lock"}, "any",
    "lock {o}", "lock it", "make {o} locked", "freeze {o} so it can't move", "lock {o} in place",
    "protect {o} from changes", "lock", "lock {o} down", "pin {o} so nothing changes it",
    "keep {o} from being edited")
add("lock_layers", {"action": "unlock"}, "any",
    "unlock {o}", "unfreeze {o}", "release the lock on {o}", "make {o} editable again", "unlock it",
    "unlock", "take the lock off {o}", "let me edit {o} again", "remove the lock from {o}")
add("hide_layers", {"action": "hide"}, "any",
    "hide {o}", "make {o} invisible", "hide it for now", "conceal {o}", "hide", "hide {o} from view",
    "make {o} disappear for now", "switch {o} to hidden", "put {o} out of sight", "toggle {o} hidden")
add("hide_layers", {"action": "show"}, "any",
    "show {o}", "unhide {o}", "make {o} visible again", "show it again", "reveal {o}", "unhide",
    "show {o} again", "make {o} visible", "switch {o} back to visible", "stop hiding {o}")

# ---------------------------------------------------------------- requests the bar must refuse
# (category, area the router may still pick or None, templates). Gold is no call at all.
NEG = []


def neg(category, area, *templates):
    NEG.append((category, area, list(templates)))


PRODUCTS = ["running shoes", "our summer sale", "a coffee shop", "a dentist", "black friday",
            "a new phone", "my bakery", "a yoga class", "the spring collection", "a webinar",
            "pet food", "a car wash", "a concert", "our app launch", "a charity run"]
neg("big", None,
    "make me an ad for {p}", "design a poster for {p}", "create an instagram post about {p}",
    "write a headline for {p}", "generate five variations of this ad", "make a banner for {p}",
    "turn this into an instagram story", "design a facebook ad for {p}", "create a carousel about {p}",
    "make a flyer for {p}", "build me a whole campaign for {p}", "write some copy for {p}",
    "come up with a slogan for {p}", "make this ad in every size", "create a new design for {p}",
    "give me three layout ideas", "redesign this whole thing", "make a logo for {p}",
    "write a caption for {p}", "make a story ad and a square ad for {p}",
    "design something eye catching for {p}", "draft an email banner for {p}",
    "suggest a colour palette for {p}", "can you make a video ad for {p}",
    "translate this ad into spanish", "rewrite the headline to be catchier",
    "make the whole ad feel more premium", "create an ad set for {p} with four images")
neg("unrelated", None,
    "what's the weather in paris", "tell me a joke", "what time is it", "who are you", "hello",
    "thanks", "hi there", "what is 12 times 7", "how do i cook rice", "who won the game last night",
    "asdf", "lol", "what can you do", "how much does dazbee cost", "send an email to my boss",
    "set a timer for 10 minutes", "play some music", "book a flight to london", "good morning",
    "what's the capital of france", "call mom", "is it going to rain", "ok", "test", "hmm",
    "how are you", "turn on the lights", "order a pizza", "what is the meaning of life",
    "remind me to post this tomorrow", "open my calendar", "qwerty", "bye", "yes", "no",
    "convert 10 dollars to euros", "where is the nearest cafe", "help")
neg("unsupported", None,
    "add a drop shadow to {o}", "crop the photo", "remove the background of {o}", "undo that",
    "export as png", "change the text to 'summer sale'", "add a border to {o}", "blur the image",
    "replace the image with a dog", "add a new page", "zoom in", "save a version",
    "make a gradient on {o}", "add a button", "share this with my team", "publish to instagram",
    "spell check this", "add a new frame", "redo", "download this as a pdf",
    "add an outline to {o}", "add a glow to {o}", "change the font to helvetica",
    "insert a picture of the beach", "add a text box", "make it a circle", "add a star shape",
    "draw a line under {o}", "copy the style of {o}", "add guides", "show the rulers",
    "make it a link", "add an animation to {o}", "apply a filter to the photo",
    "sharpen the image", "write 'sale' on {o}", "add a new size for facebook",
    "add a mask to {o}", "replace the logo", "find and replace the word sale",
    "select all", "zoom to fit", "make a gif")
neg("vague", "colour_and_brand",
    "change the colour of {o}", "make {o} a different colour", "change the colour", "recolour {o}",
    "make it more transparent", "change the opacity", "use a brand colour", "make {o} more see-through",
    "change the font", "use a brand font")
neg("vague", "size_and_shape",
    "rotate {o}", "resize {o}", "change the size of {o}", "set the font size", "change the font size",
    "flip {o}", "turn {o}")
neg("vague", "arrange",
    "move {o}", "align {o}", "distribute {o}", "change the layer order", "arrange {o}",
    "rearrange {o}")
neg("vague", "text_style",
    "change the weight", "change the text case", "change the spacing", "align the text",
    "change the font weight of {o}", "style the text")
neg("vague", None,
    "make it pop", "make it look better", "fix this", "make it nicer", "do something", "improve {o}",
    "make {o} better", "this looks wrong", "make it more modern", "clean this up", "hmm not like that",
    "make it more fun", "it looks off", "make {o} more professional", "tweak it", "jazz {o} up",
    "change {o}", "edit this", "can you help with {o}", "do the thing", "make it work")
neg("negated", None,
    "don't delete {o}", "never mind", "do not make it bold", "don't change anything",
    "leave {o} as it is", "no don't", "cancel", "stop", "don't move it", "keep {o} the same")
neg("multi", None,
    "make {o} bold and red", "duplicate {o} and move it right", "make it bigger and center it",
    "make {o} italic and blue", "group these and send them to the back", "make {o} all caps and smaller",
    "delete the logo and make the headline bigger", "rotate {o} 45 degrees and make it red",
    "bold the title and underline the price", "align these left and lock them")


# ---------------------------------------------------------------- filling templates
SPLITS = ("train", "calib", "validation", "test")


def split_of(key, test=0.17, val=0.13, calib=0.15):
    h = int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return ("test" if h < test else "validation" if h < test + val
            else "calib" if h < test + val + calib else "train")


def assign_splits(templates, key):
    """Each template to one split; with four or more, every split gets at least one."""
    order = sorted(templates, key=lambda t: hashlib.sha256((key + t).encode()).hexdigest())
    out = {t: split_of(key + t) for t in order}
    if len(order) >= len(SPLITS):
        for s in SPLITS:
            if s not in out.values():
                donor = max(sorted(set(out.values())), key=lambda x: list(out.values()).count(x))
                t = next(t for t in order if out[t] == donor)
                out[t] = s
    return out


def objects(kind, split, rng):
    pools = {"text": (TEXT_OBJ, TEXT_OBJ_TEST), "any": (ANY_OBJ, ANY_OBJ_TEST),
             "many": (MANY_OBJ, MANY_OBJ_TEST)}
    base, held = pools.get(kind, (ANY_OBJ, ANY_OBJ_TEST))
    if split == "test" and rng.random() < 0.3:
        return rng.choice(held)
    return rng.choice(base)


def number_for(tool, args, rng):
    if tool == "resize":
        return rng.choice([5, 10, 10, 15, 20, 20, 25, 30, 40, 50, 50, 75, 100, 150, 200])
    if tool == "set_font_size":
        return rng.choice([8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 60, 64, 72,
                           80, 96, 100, 120, 144])
    if tool == "rotate":
        return rng.choice([5, 10, 15, 20, 30, 45, 45, 60, 90, 90, 120, 135, 180, 270])
    if tool == "round_corners":
        return rng.choice([2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 50, 100])
    if tool == "set_opacity":
        return rng.choice([0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100])
    if tool == "move_layers":
        return rng.choice([1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 64, 100, 200])
    raise KeyError(tool)


def hex_code(rng):
    digits = "".join(rng.choice("0123456789abcdef") for _ in range(6))
    return "#" + (digits.upper() if rng.random() < 0.5 else digits)


def americanise(text):
    for a, b in [("colour", "color"), ("centre", "center"), ("capitalise", "capitalize"),
                 ("italicise", "italicize"), ("grey", "gray"), ("recolour", "recolor")]:
        text = text.replace(a, b)
    return text


def typo(text, rng):
    words = text.split(" ")
    cands = [i for i, w in enumerate(words) if len(w) > 4 and w.isalpha()]
    if not cands:
        return text
    i = rng.choice(cands)
    w = words[i]
    j = rng.randrange(len(w) - 1)
    words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


def finish(text, rng, wrap=True):
    if wrap:
        text = rng.choice(PREFIX) + text + rng.choice(SUFFIX)
    if rng.random() < 0.35:
        text = americanise(text)
    if rng.random() < 0.07:
        text = typo(text, rng)
    r = rng.random()
    if r < 0.4:
        text = text[:1].upper() + text[1:]
    elif r < 0.45:
        text = text.upper() if "#" not in text else text
    return re.sub(r"\s+", " ", text).strip()


def fill(tool, args, kind, template, split, rng):
    """One request from a template, and its gold arguments."""
    gold = dict(args)
    slots = {}
    if "{o}" in template:
        slots["o"] = objects(kind, split, rng)
    if "{n}" in template:
        n = number_for(tool, args, rng)
        slots["n"] = str(n)
        for k, v in args.items():
            if v == "{n}":
                gold[k] = n
            elif v == "-{n}":
                gold[k] = -n
    if "{c}" in template:
        name = rng.choice(sorted(COLOURS))
        words = COLOURS[name] + (COLOURS_TEST.get(name, []) if split == "test" else [])
        slots["c"] = rng.choice(words)
        gold["colour"] = name
    if "{r}" in template:
        role = rng.choice(sorted(ROLES))
        slots["r"] = rng.choice(ROLES[role])
        gold["role"] = role
    if "{h}" in template:
        slots["h"] = hex_code(rng)
        gold["hex"] = slots["h"]
    if "{d}" in template:
        d = rng.choice(["left", "right", "up", "down"])
        slots["d"] = d
        gold["direction"] = d
    text = template
    if slots.get("d") in ("up", "down"):
        text = text.replace("to the {d}", "{d}")
    for k, v in slots.items():
        text = text.replace("{" + k + "}", v)
    return text, gold


def make_split(split, n_on, n_off, seed):
    rng = random.Random(seed)
    rows, seen = [], set()
    # On-topic: each call's templates of this split, sampled round-robin.
    pool = []
    for tool, args, kind, templates in I:
        sp = assign_splits(templates, tool + json.dumps(args, sort_keys=True))
        mine = [t for t, s in sp.items() if s == split]
        if not mine and split != "train":
            continue
        pool.append((tool, args, kind, mine or templates))
    tries = 0
    while len([r for r in rows if r["answers"]]) < n_on and tries < n_on * 50:
        tries += 1
        tool, args, kind, mine = pool[tries % len(pool)]
        template = rng.choice(mine)
        text, gold = fill(tool, args, kind, template, split, rng)
        q = finish(text, rng)
        if q.lower() in seen:
            continue
        seen.add(q.lower())
        rows.append({"query": q, "answers": [{"name": tool, "arguments": gold}],
                     "area": AREA_OF[tool], "category": "action", "template": template})
    # Refusals.
    npool = []
    for cat, area, templates in NEG:
        sp = assign_splits(templates, cat + str(area))
        mine = [t for t, s in sp.items() if s == split]
        npool += [(cat, area, t) for t in (mine if split != "train" or mine else templates)]
    tries = 0
    weights = {"big": 3, "unrelated": 3, "unsupported": 3, "vague": 2, "negated": 1, "multi": 1}
    by_cat = {}
    for x in npool:
        by_cat.setdefault(x[0], []).append(x)
    cats = sorted(by_cat)
    while len([r for r in rows if not r["answers"]]) < n_off and tries < n_off * 200:
        tries += 1
        cat = rng.choices(cats, [weights[c] for c in cats])[0]
        _, area, template = rng.choice(by_cat[cat])
        text = template.replace("{p}", rng.choice(PRODUCTS)).replace(
            "{o}", objects("any", split, rng))
        q = finish(text, rng, wrap=cat != "unrelated" or rng.random() < 0.5)
        if q.lower() in seen:
            continue
        seen.add(q.lower())
        rows.append({"query": q, "answers": [], "area": area, "category": cat, "template": template})
    rng.shuffle(rows)
    return rows


REFUSE = "No tool here does this."


def reasoning(call):
    """The short line the engine has the model write before its call (it always opens a
    <think> block): the tool, then each argument and its value."""
    if call is None:
        return REFUSE
    if not call["arguments"]:
        return f"{call['name']}, no arguments."
    return f"{call['name']}: " + ", ".join(f"{k} {json.dumps(v)}" for k, v in call["arguments"].items()) + "."


def needle_rows(rows, rng, misroute=0.35):
    """Needle training rows for both turns: the router's pick, then the area's call. Some requests
    also appear with another area's tools and no call, so a misroute ends in nothing."""
    out = []
    for r in rows:
        q, area = r["query"], r["area"]
        call = r["answers"][0] if r["answers"] else None
        route = {"name": area, "arguments": {}} if area else None
        out.append({"query": q, "tools": AREAS, "answers": [route] if route else [],
                    "reasoning": reasoning(route)})
        if area:
            out.append({"query": q, "tools": ACTIONS[area], "answers": [call] if call else [],
                        "reasoning": reasoning(call)})
        if rng.random() < misroute:
            other = rng.choice([a for a in ACTIONS if a != area])
            out.append({"query": q, "tools": ACTIONS[other], "answers": [], "reasoning": REFUSE})
    rng.shuffle(out)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "tools.json"), "w", encoding="utf-8") as f:
        json.dump({"areas": AREAS, "actions": ACTIONS}, f)
    sizes = {"train": (2650, 380), "calib": (700, 100), "validation": (440, 64), "test": (440, 64)}
    for i, (split, (n_on, n_off)) in enumerate(sizes.items()):
        rows = make_split(split, n_on, n_off, seed=100 + i)
        with open(os.path.join(OUT, f"{split}.queries.jsonl"), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        cats = {}
        for r in rows:
            cats[r["category"]] = cats.get(r["category"], 0) + 1
        print(split, len(rows), cats)
        if split in ("train", "validation"):
            nr = needle_rows(rows, random.Random(7 + i))
            with open(os.path.join(OUT, f"{split}.needle.jsonl"), "w", encoding="utf-8") as f:
                for r in nr:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print("  needle rows", len(nr))
    # Every template is in exactly one split.
    print("templates", sum(len(t) for *_, t in I), "calls", len(I),
          "refusal templates", sum(len(t) for *_, t in NEG))


if __name__ == "__main__":
    main()
