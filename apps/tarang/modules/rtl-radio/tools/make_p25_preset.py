"""Builds android/src/main/assets/p25/charlotte.json: the Charlotte UASI P25 system (its sites' control channels,
WACN / system ID / NACs) and the dispatch and operations talkgroups, as listed by the RadioReference database
(system 6561) on 2026-10-28. Usage: python3 make_p25_preset.py ../android/src/main/assets/p25/charlotte.json"""
import json, sys
CMPD = """659|D|CMPD Cntrl Disp|Central Division Dispatch
657|D|CMPD Cntrl Conf|Central Division Conference
815|DE|CMPD Cntrl Tac|Central Division Tactical
669|DE|CMPD Cntrl SCU|Central Division Street Crimes Unit
559|D|CMPD East Disp|Eastway Division Dispatch
563|D|CMPD East Conf|Eastway Division Conference
823|DE|CMPD East Tac|Eastway Division Tactical
825|DE|CMPD East SCU|Eastway Division Street Crimes Unit
533|D|CMPD Fredm Disp|Freedom Division Dispatch
539|D|CMPD Fredm Conf|Freedom Division Conference
853|DE|CMPD Fredm Tac|Freedom Division Tactical
855|DE|CMPD Fredm SCU|Freedom Division Street Crimes Unit
561|D|CMPD HickGr Disp|Hickory Grove Division Dispatch
565|D|CMPD HickGr Conf|Hickory Grove Division Conference
831|DE|CMPD HickGr Tac|Hickory Grove Division Tactical
833|DE|CMPD HickGr SCU|Hickory Grove Division Street Crimes Unit
547|D|CMPD Indpce Disp|Independence Division Dispatch
551|D|CMPD Indpce Conf|Independence Division Conference
837|DE|CMPD Indpce Tac|Independence Division Tactical
839|DE|CMPD Indpce SCU|Independence Division Street Crimes Unit
661|D|CMPD Metro Disp|Metro Division Dispatch
665|D|CMPD Metro Conf|Metro Division Conference
819|DE|CMPD Metro Tac|Metro Division Tactical
821|DE|CMPD Metro SCU|Metro Division Street Crimes Unit
557|D|CMPD North Disp|North Division Dispatch
555|D|CMPD North Conf|North Division Conference
567|DE|CMPD North Tac|North Division Tactical
829|DE|CMPD North SCU|North Division Street Crimes Unit
663|D|CMPD NTryon Disp|North Tryon Division Dispatch
667|D|CMPD NTryon Conf|North Tryon Division Conference
817|DE|CMPD NTryon Tac|North Tryon Division Tactical
827|DE|CMPD NTryon SCU|North Tryon Division Street Crimes Unit
543|D|CMPD Provdn Disp|Providence Division Dispatch
541|D|CMPD Provdn Conf|Providence Division Conference
553|DE|CMPD Provdn Tac|Providence Division Tactical
835|DE|CMPD Provdn SCU|Providence Division Street Crimes Unit
545|D|CMPD South Disp|South Division Dispatch
549|D|CMPD South Conf|South Division Conference
845|DE|CMPD South Tac|South Division Tactical
847|DE|CMPD South SCU|South Division Street Crimes Unit
687|D|CMPD Univ Disp|University Division Dispatch
685|D|CMPD Univ Conf|University Division Conference
693|DE|CMPD Univ Tac|University Division Tactical
697|DE|CMPD Univ SCU|University Division Street Crimes Unit
531|D|CMPD Westvr Disp|Westover Division Dispatch
535|D|CMPD Westvr Conf|Westover Division Conference
849|DE|CMPD Westvr Tac|Westover Division Tactical
851|DE|CMPD Westvr SCU|Westover Division Street Crimes Unit
529|D|CMPD StlCrk Disp|Steele Creek Division Dispatch
527|D|CMPD StlCrk Conf|Steele Creek Division Conference
841|DE|CMPD StlCrk Tac|Steele Creek Division Tactical
843|DE|CMPD StlCrk SCU|Steele Creek Division Street Crimes Unit
515|D|CMPD Emerg|Emergency
517|D|CMPD Emerg|Emergency
523|D|CMPD Emerg|Emergency
589|DE|CEU 1|CEU 1
591|DE|CEU 2|CEU 2
593|DE|CEU 3|CEU 3
594|DE|CEU 4|CEU 4
907|DE|CMPD Tac/Surv|CMPD Tac/Surv
919|D|CMPD Academy 1|Police Academy 1
920|DE|CMPD Academy 2|Police Academy 2
921|DE|CMPD Academy 3|Police Academy 3
30535|DE|CMPD Air Ops|Air Operations
30538|DE|CMPD Intel 30538|Intelligence
30539|DE|CMPD Intel 1|Intelligence 1
30542|DE|CLT Wide|CLT Wide
30681|D|CMPD Airport Dsp|CMPD Airport Dispatch
30682|D|CMPD Airport Cnf|CMPD Airport Conference
583|DE|CMPD SWAT 1|SWAT 1
585|DE|CMPD SWAT 2|SWAT 2
587|DE|CMPD SWAT 3|SWAT 3
675|DE|CMPD VCAT 1|VCAT 1
677|DE|CMPD VCAT 2|VCAT 2
681|DE|CMPD VCAT3|VCAT 3
1273|DE|CMPD BOMB 1|Bomb Squad 1
30541|DE|CMPD BOMB 2|Bomb Squad 2
1779|D|CMPD ACO Disp|Animal Control Dispatch
1781|D|CMPD ACO Conf|Animal Control Conference"""
CFD = """1027|D|CFD ALARM|Fire Alarm
1029|D|CFD 1B|Fire Ops 1B
1031|D|CFD 1C|Fire Ops 1C
1033|D|CFD 1D|Fire Ops 1D
1035|D|CFD 1E|Fire Ops 1E
1037|D|CFD 1F|Fire Ops 1F
1039|D|CFD 1G|Fire Ops 1G
1041|D|CFD 1H|Fire Ops 1H
983|D|CFD 1I|Fire Ops 1I
985|D|CFD 1J|Fire Ops 1J
987|DE|CFD 1K|Fire Ops 1K
991|DE|CFD 1CONF|Fire Conference 1
1057|D|CFD 2B|Fire Ops 2B
1059|D|CFD 2C|Fire Ops 2C
1061|D|CFD 2D|Fire Ops 2D
1063|D|CFD 2E|Fire Ops 2E
1065|D|CFD 2F|Fire Ops 2F
1067|D|CFD 2G|Fire Ops 2G
1069|D|CFD 2H|Fire Ops 2H
1071|D|CFD 2I|Fire Ops 2I
1073|D|CFD 2J|Fire Ops 2J
1075|D|CFD 2K|Fire Ops 2K
1077|DE|CFD 2CONF|Fire Conference 2
1085|D|CFD 5B|Fire Training 5B
1087|D|CFD 5C|Fire Training 5C
1089|D|CFD 5D|Fire Training 5D
1091|D|CFD 5E|Fire Training 5E
1093|D|CFD 5F|Fire Training 5F
1095|D|CFD 5G|Fire Training 5G
1097|D|CFD 5H|Fire Training 5H
1301|D|CFD 5I|Fire Training 5I
1303|D|CFD 5J|Fire Training 5J
1307|D|CFD 5CONF|Fire Conference 5
1099|D|CFD EMG-1|Fire Emergency Zone 1
1101|D|CFD EMG-2|Fire Emergency Zone 2
1103|D|CFD EMG-5|Fire Emergency Zone 5
1105|D|CFD EMG-6|Fire Emergency Zone 6
1107|D|CFD EMG-7|Fire Emergency Zone 7
1309|D|CFD EMG-8|Fire Emergency Zone 8
1109|D|CFD 10 LOGIS|Fire Logistics 10
1111|D|CFD 10 ARSON|Fire Arson 10
1113|DE|CFD 10 CHIEF|Fire Chiefs 10
1115|D|CFD 10 PREVNT|Fire Prevention 10
1117|D|CFD 10 COMCTR|Fire Communications 10
1329|D|CFD 10 ADMIN|Fire Administration 10
1119|D|CFD 10 CONF|Fire Conference 10
1317|D|CFD EMG 16|Fire Emergency Zone 16
1319|D|CFD EMG 17|Fire Emergency Zone 17
30514|D|CFD EMG 3|Fire Emergency Zone 3
30515|D|CFD EMG 4|Fire Emergency Zone 4
30528|DE|CFD Hazmat OPS 1|Fire Hazmat 1
30529|DE|CFD Hazmat OPS 2|Fire Hazmat 2
30564|D|CFD 1L Staging|Fire Ops 1L - Staging"""
EMS = """403|D|EMS-DISP|Mecklenburg EMS (Medic) Dispatch
453|D|MEC DISP|Mecklenburg Fire Dispatch
457|D|MEC OPS 3|Mecklenburg Operations 3
459|D|MEC OPS 4|Mecklenburg Operations 4
461|D|MEC OPS 5|Mecklenburg Operations 5
413|D|MEC OPS 6|Mecklenburg Operations 6
759|D|MEC OPS 7|Mecklenburg Operations 7
761|D|MEC OPS 8|Mecklenburg Operations 8
763|D|MEC OPS 9|Mecklenburg Operations 9
765|D|MEC OPS 10|Mecklenburg Operations 10
767|D|MEC OPS 11|Mecklenburg Operations 11
455|D|MEC OPS 12|Mecklenburg Operations 12
463|D|MEC OPS 13|Mecklenburg Operations 13
405|D|MEC OPS 14|Mecklenburg Operations 14
407|D|MEC OPS 15|Mecklenburg Operations 15
409|D|MEC OPS 16|Mecklenburg Operations 16
411|D|MEC OPS 17|Mecklenburg Operations 17
185|D|MEC EMG 3|Mecklenburg Emergency 3
415|DE|EMS ADMIN|Mecklenburg EMS Administration
467|D|MEC CONF|Mecklenburg Conference
769|DE|EMS-NET1|EMS Non-Emergency Transport
771|DE|EMS-CONF|Mecklenburg EMS Conference
773|D|EMS-LOGIS|Mecklenburg EMS Logistics"""
MCSO = """1557|D|MCSO Patrol 1|Sheriff 1 Dispatch
1559|D|MCSO Patrol 2|Sheriff 2
1561|D|MCSO Patrol 3|Sheriff 3
1563|D|MCSO Patrol 4|Sheriff 4
1565|D|MCSO Patrol 5|Sheriff 5
1567|D|MCSO Patrol 6|Sheriff 6
1569|D|MCSO Patrol 7|Sheriff 7
999|D|MCSO Court 1|Courts 1
1001|D|MCSO Court 2|Courts 2
29|D|MCSO Jail PrsCtr|Jail Arrest Processing Center
189|DE|MCSO Jail 1|Jail Central 1"""
tgs = []
for cat, block in (("CMPD", CMPD), ("Fire", CFD), ("Meck Fire/EMS", EMS), ("Sheriff", MCSO)):
    for line in block.split("\n"):
        i, mode, tag, desc = line.split("|")
        tgs.append({"id": int(i), "name": tag, "desc": desc, "cat": cat, "enc": "E" in mode})
ids = [t["id"] for t in tgs]
assert len(ids) == len(set(ids)), "duplicate ids"
preset = {
    "name": "Charlotte UASI",
    "source": "RadioReference database, system 6561 (Charlotte UASI), retrieved 2026-10-28 for this app's own use",
    "wacn": 0xBEE00, "sysid": 0x2D0,
    "sites": [
        {"name": "Mecklenburg Simulcast", "rfss": 1, "site": 1, "nac": 0x2D0, "ccs": [852912500, 853262500, 853350000, 853812500]},
        {"name": "Union Simulcast", "rfss": 1, "site": 2, "nac": 0x2D0, "ccs": [853312500, 853650000, 853900000, 853937500]},
        {"name": "Cabarrus Simulcast", "rfss": 1, "site": 3, "nac": 0x2D3, "ccs": [852350000, 852925000, 853437500, 853787500]},
        {"name": "Gastonia Simulcast", "rfss": 1, "site": 10, "nac": 0x2DA, "ccs": [851737500, 852650000, 852875000, 853462500]},
        {"name": "Stanly Simulcast", "rfss": 1, "site": 11, "nac": 0x2DB, "ccs": [772131250, 772506250, 772906250, 774493750]},
    ],
    "talkgroups": tgs,
}
open(sys.argv[1], "w").write(json.dumps(preset, separators=(",", ":")))
print(len(tgs), "talkgroups,", sum(t["enc"] for t in tgs), "encrypted")
