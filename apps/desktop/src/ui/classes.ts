/** On a link in a table row: makes the whole row its hit area. */
export const stretchedLink =
  "flex min-w-0 items-center gap-2 text-inherit no-underline outline-none after:absolute after:inset-0 focus-visible:after:shadow-focus";

/** On a cell that holds its own buttons inside a row with a `stretchedLink`. */
export const cellAbove = "relative z-[1]";
