-- Ticket.notes: Optionaler Freitext, den das Personal am Shop-Monitor zu
-- einem Ticket hinterlegt (z. B. "kommt morgen mit Kind", "Schluessel nicht
-- zurueckgegeben"). Hat keine Auswirkung auf die Zutrittslogik und kann
-- jederzeit ueberschrieben werden.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "notes" TEXT;
