UPDATE course_packages 
SET council_approved = true, priority = 5
WHERE id IN ('86bee7c1-5955-456e-8c1a-c05bbc1084da', '0ce3bdeb-c0a3-4b25-a7c8-a38e88ddcb95')
AND status = 'queued';