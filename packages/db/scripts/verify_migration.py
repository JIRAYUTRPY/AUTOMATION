import sqlite3, sys
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys = ON')
db.executescript(open(sys.argv[1]).read())
now = '2026-10-24T00:00:00Z'
def ok(label, cond): print(('PASS ' if cond else 'FAIL ') + label); return cond
def fails(sql, args=()):
    try: db.execute(sql, args); return False
    except sqlite3.IntegrityError: return True
results = []
db.execute("INSERT INTO projects VALUES ('p1','Demo','https://example.com','https://example.com','/','none',?,?)", (now, now))
db.execute("INSERT INTO crawl_jobs(id,project_id,status,max_pages,created_at) VALUES ('c1','p1','queued',100,?)", (now,))
db.execute("INSERT INTO pages(id,crawl_job_id,project_id,url,normalized_url,scan_status) VALUES ('pg1','c1','p1','https://example.com/','https://example.com/','scanned')")
db.execute("INSERT INTO elements(id,page_id,category,tag_name,is_visible,detected_at) VALUES ('e1','pg1','button','button',1,?)", (now,))
db.execute("INSERT INTO test_runs VALUES ('r1','p1','queued','key-1',?,'{}',?,NULL,NULL)", (now, now))
db.execute("INSERT INTO test_results(id,run_id,test_name,status) VALUES ('t1','r1','x','passed')")
db.execute("INSERT INTO step_results(id,result_id,step_index,action,status) VALUES ('s1','t1',0,'assert_visible','passed')")
db.execute("INSERT INTO artifacts VALUES ('a1','p1','r1','t1','screenshot','runs/r1/a1.png','image/png',10,?)", (now,))
results.append(ok('valid rows insert', True))
results.append(ok('duplicate idempotency_key rejected', fails("INSERT INTO test_runs VALUES ('r2','p1','queued','key-1',?,'{}',?,NULL,NULL)", (now, now))))
results.append(ok('run without approval rejected', fails("INSERT INTO test_runs(id,project_id,status,idempotency_key,approved_at,approved_plan,created_at) VALUES ('r3','p1','queued','k3',NULL,'{}',?)", (now,))))
results.append(ok('invalid run status rejected', fails("INSERT INTO test_runs VALUES ('r4','p1','weird','k4',?,'{}',?,NULL,NULL)", (now, now))))
results.append(ok('duplicate page URL per crawl rejected', fails("INSERT INTO pages(id,crawl_job_id,project_id,url,normalized_url,scan_status) VALUES ('pg2','c1','p1','u','https://example.com/','scanned')")))
results.append(ok('absolute artifact path rejected', fails("INSERT INTO artifacts VALUES ('a2','p1',NULL,NULL,'report','/etc/passwd','text/plain',1,?)", (now,))))
results.append(ok('path traversal artifact key rejected', fails("INSERT INTO artifacts VALUES ('a3','p1',NULL,NULL,'report','a/../../x','text/plain',1,?)", (now,))))
results.append(ok('orphan project FK rejected', fails("INSERT INTO crawl_jobs(id,project_id,status,max_pages,created_at) VALUES ('cx','nope','queued',1,?)", (now,))))
db.execute("DELETE FROM projects WHERE id='p1'")
counts = {t: db.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ['crawl_jobs','pages','elements','test_runs','test_results','step_results','artifacts']}
results.append(ok(f'project delete cascades to all children {counts}', all(v == 0 for v in counts.values())))
sys.exit(0 if all(results) else 1)
