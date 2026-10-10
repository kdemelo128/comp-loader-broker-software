# Checkpoint (b): raw before/after output

Output of `node tests/tools/golden.mjs --diff before.json after.json`: 4.0.0 at `0252cda` (before) against 4.1.0 on this branch (after). Workbook cells show value then formula. The readable version is `checkpoint-b-results.md`.

| Case and figure | Before | After |
|---|---|---|
| om_retail · Deal workbook Annual debt service | 326309.7024 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 326309.7024 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| om_retail · Deal workbook Loan at the minimum DSCR | 4044106.8419 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 4044106.8419 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| om_netlease · Deal workbook Annual debt service | 165937.337 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 165937.337 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| om_netlease · Deal workbook Loan at the minimum DSCR | 1769971.2751 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 1769971.2751 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| om_multifamily · Deal workbook Annual debt service | 632383.1442 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 632383.1442 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| om_multifamily · Deal workbook Loan at the minimum DSCR | 7387728.5364 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 7387728.5364 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| WALT case · Overview tile: WALT | 2.7 yrs | 3.9 yrs |
| WALT case · Overview: WALT by SF | 2.7 yrs | 3.7 yrs |
| WALT case · Deal workbook Annual debt service | 151771.9546 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 151771.9546 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| WALT case · Deal workbook Loan at the minimum DSCR | 1541786.825 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 1541786.825 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| 27.4-year amortization · Annual debt service | $336,150 | $336,079 |
| 27.4-year amortization · Overview: largest loan it supports | $3,925,719 | $3,926,545 |
| 27.4-year amortization · Overview: cash flow after debt | $57,300 | $57,371 |
| 27.4-year amortization · What if: price for a 15% IRR | $5,569,533 | $5,569,562 |
| 27.4-year amortization · Deal workbook Annual debt service | 336150.2585 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 336079.4782 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| 27.4-year amortization · Deal workbook Debt-service coverage (DSCR) | 1.1705 =IFERROR(IF(OR(B6="",B34=""),"",B6/B34),"") | 1.1707 =IFERROR(IF(OR(B6="",B34=""),"",B6/B34),"") |
| 27.4-year amortization · Deal workbook Cash flow after debt service | 57299.7415 =IF(OR(B6="",B34=""),"",B6-B34) | 57370.5218 =IF(OR(B6="",B34=""),"",B6-B34) |
| 27.4-year amortization · Deal workbook Break-even occupancy | 0.8177 =IFERROR(IF(OR(B12="",B34=""),"",IF(N(B16)>0,(B12+B34)/B16,IF(N(B11)<=0,"",IF(N(B14)>0,(B12+B34)/B11*B14,(B12+B34)/B11)))),"") | 0.8176 =IFERROR(IF(OR(B12="",B34=""),"",IF(N(B16)>0,(B12+B34)/B16,IF(N(B11)<=0,"",IF(N(B14)>0,(B12+B34)/B11*B14,(B12+B34)/B11)))),"") |
| 27.4-year amortization · Deal workbook Loan at the minimum DSCR | 3925718.5343 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 3926545.3127 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| 27.4-year amortization · Deal workbook Maximum loan | 3925718.5343 =IF(COUNT(B45:B47)=0,"",MIN(B45:B47)) | 3926545.3127 =IF(COUNT(B45:B47)=0,"",MIN(B45:B47)) |
| Negative NOI · Purchase / asking price | -$833,333 | (none) |
| Negative NOI · Cap rate (NOI ÷ price) | 6% | (none) |
| Negative NOI · Price per SF | -$83.33 | (none) |
| Negative NOI · Overview: price | -$833,333 | — |
| Negative NOI · What if: Price | -$833,333 | — |
| Negative NOI · Deal workbook Annual debt service |  =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") |  =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| Negative NOI · Deal workbook Loan at the minimum DSCR |  =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") |  =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| Sub-cent values · NOI, year 1 (rent roll projection) | $342,712 | $342,713 |
| Sub-cent values · Projection year 1: EGI / NOI | $478,462 · $342,712 | $478,463 · $342,713 |
| Sub-cent values · Projection year 3: EGI / NOI | $506,673 · $362,655 | $506,672 · $362,655 |
| Sub-cent values · Projection year 7: EGI / NOI | $516,439 · $354,347 | $516,439 · $354,346 |
| Sub-cent values · Projection year 8: EGI / NOI | $577,279 · $410,324 | $577,278 · $410,323 |
| Sub-cent values · Projection year 10: EGI / NOI | $637,424 · $460,301 | $637,423 · $460,300 |
| Sub-cent values · Deal workbook Loan amount | 3622850.3177 =IF(OR(B5="",B28=""),"",B5*B28) | 3622850.3155 =IF(OR(B5="",B28=""),"",B5*B28) |
| Sub-cent values · Deal workbook Annual debt service | 281972.8584 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,B30*12,B33)*12)),"") | 281972.8583 =IFERROR(IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12)),"") |
| Sub-cent values · Deal workbook Cash flow after debt service | 111477.1379 =IF(OR(B6="",B34=""),"",B6-B34) | 111477.1417 =IF(OR(B6="",B34=""),"",B6-B34) |
| Sub-cent values · Deal workbook Loan at the minimum DSCR | 4044106.804 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,B30*12,1)*12))),"") | 4044106.8419 =IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12))),"") |
| Sub-cent values · Deal workbook Maximum loan | 3622850.3177 =IF(COUNT(B45:B47)=0,"",MIN(B45:B47)) | 3622850.3155 =IF(COUNT(B45:B47)=0,"",MIN(B45:B47)) |
| Tool Net effective rent (example) · Net effective rent | $39.86/SF (net rent spread evenly over the term) | $39.86/SF (net of free rent, TI and commissions, spread evenly over the term) |
| Tool Net effective rent (example) · Discounted net effective | $35.26/SF (level rent with the same value at 8.0%) | (none) |
| Tool Break-even occupancy (no GPR, EGI and occupancy) · Enter potential rent and expenses | — | (none) |
| Tool Quick value (negative NOI) · Price | -$833,333 (NOI ÷ cap rate) | — |
| Tool Net effective rent (no commission) · Net effective rent | $81.60/SF (net rent spread evenly over the term) | $81.60/SF (net of free rent and TI, spread evenly over the term) |
| Tool Net effective rent (no commission) · Discounted net effective | $78.02/SF (level rent with the same value at 8.0%) | (none) |
| Tool Net effective rent (with commission) · Net effective rent | $76.45/SF (net rent spread evenly over the term) | $76.45/SF (net of free rent, TI and commissions, spread evenly over the term) |
| Tool Net effective rent (with commission) · Discounted net effective | $70.56/SF (level rent with the same value at 8.0%) | (none) |
| Tool WALT (two leases) · WALT by income, to 4 decimals | 3.5945 | 3.5958 |
| Comps CoStar set · comp workbook Sale Comps K19 | $13,025,000.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),K$4:K$18),"") | $13,025,000.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),--(K$4:K$18>0),--(L$4:L$18>0),K$4:K$18),"") |
| Comps CoStar set · comp workbook Sale Comps L19 | $16,855.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),L$4:L$18),"") | $16,855.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),--(K$4:K$18>0),--(L$4:L$18>0),L$4:L$18),"") |
| Comps CoStar set · comp workbook Sale Comps P19 | $17,882.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),P$4:P$18),"") | $17,882.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),P$4:P$18),"") |
| Comps CoStar set · comp workbook Sale Comps R19 | $728.39 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),P$4:P$18),"") | $728.39 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),P$4:P$18),"") |
| Comps CoStar set · comp workbook Sale Comps U19 | $14,376.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),U$4:U$18),"") | $14,376.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),U$4:U$18),"") |
| Comps CoStar set · comp workbook Sale Comps V19 | $460.84 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),U$4:U$18),"") | $460.84 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),U$4:U$18),"") |
| Comps CoStar set · comp workbook Lease Comps example NER (P4) | $80.50 =IF(OR(K4="",I4=""),"",(K4*(1+IF(M4="",0,M4)*((I4/12-1)/2))*((I4-IF(N4="",0,N4))/12)-IF(O4="",0,O4))/(I4/12)) | $81.60 =IF(OR(K4="",I4=""),"",(IF(IF(M4="",0,M4)=0,K4*(ROUND(I4,0))/12,K4*(((1+IF(M4="",0,M4))^INT((ROUND(I4,0))/12)-1)/IF(M4="",0,M4)+((ROUND(I4,0))-12*INT((ROUND(I4,0))/12))/12*(1+IF(M4="",0,M4))^INT((ROUND(I4,0))/12)))-IF(IF(M4="",0,M4)=0,K4*(IF(N4="",0,N4))/12,K4*(((1+IF(M4="",0,M4))^INT((IF(N4="",0,N4))/12)-1)/IF(M4="",0,M4)+((IF(N4="",0,N4))-12*INT((IF(N4="",0,N4))/12))/12*(1+IF(M4="",0,M4))^INT((IF(N4="",0,N4))/12)))-IF(O4="",0,O4))/(ROUND(I4,0)/12)) |
| Comps CoStar set + a $0-price comp · weighted $/SF (workbook, stats) | $595.97 | $772.77 |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps K19 | $13,025,000.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),K$4:K$18),"") | $13,025,000.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),--(K$4:K$18>0),--(L$4:L$18>0),K$4:K$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps L19 | $21,855.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),L$4:L$18),"") | $16,855.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(L$4:L$18),--(K$4:K$18>0),--(L$4:L$18>0),L$4:L$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps M19 | $595.97 =IFERROR(IF(OR(K19="",L19=""),"",K19/L19),"") | $772.77 =IFERROR(IF(OR(K19="",L19=""),"",K19/L19),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps P19 | $28,772.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),P$4:P$18),"") | $17,882.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),P$4:P$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps R19 | $452.70 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),P$4:P$18),"") | $728.39 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(P$4:P$18),--(K$4:K$18>0),--(P$4:P$18>0),P$4:P$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps U19 | $14,376.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),U$4:U$18),"") | $14,376.00 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),U$4:U$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Sale Comps V19 | $460.84 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),U$4:U$18),"") | $460.84 =IFERROR(SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),K$4:K$18)/SUMPRODUCT(--ISNUMBER(K$4:K$18),--ISNUMBER(U$4:U$18),--(K$4:K$18>0),--(U$4:U$18>0),U$4:U$18),"") |
| Comps CoStar set + a $0-price comp · comp workbook Lease Comps example NER (P4) | $80.50 =IF(OR(K4="",I4=""),"",(K4*(1+IF(M4="",0,M4)*((I4/12-1)/2))*((I4-IF(N4="",0,N4))/12)-IF(O4="",0,O4))/(I4/12)) | $81.60 =IF(OR(K4="",I4=""),"",(IF(IF(M4="",0,M4)=0,K4*(ROUND(I4,0))/12,K4*(((1+IF(M4="",0,M4))^INT((ROUND(I4,0))/12)-1)/IF(M4="",0,M4)+((ROUND(I4,0))-12*INT((ROUND(I4,0))/12))/12*(1+IF(M4="",0,M4))^INT((ROUND(I4,0))/12)))-IF(IF(M4="",0,M4)=0,K4*(IF(N4="",0,N4))/12,K4*(((1+IF(M4="",0,M4))^INT((IF(N4="",0,N4))/12)-1)/IF(M4="",0,M4)+((IF(N4="",0,N4))-12*INT((IF(N4="",0,N4))/12))/12*(1+IF(M4="",0,M4))^INT((IF(N4="",0,N4))/12)))-IF(O4="",0,O4))/(ROUND(I4,0)/12)) |
| Negative NOI · What doesn't add up: The NOI is negative (-$50,000), so no pr… | (none) | The NOI is negative (-$50,000), so no price is worked out from the stated 6.00% cap rate. |
| Tool Net effective rent (example) · Net effective rent, discounted | (none) | $35.26/SF (level rent with the same present value at 8.0%, net of free rent, TI and commissions) |
| Tool Break-even occupancy (no GPR, EGI and occupancy) · Break-even occupancy (est.) | (none) | 80.1% |
| Tool Break-even occupancy (no GPR, EGI and occupancy) · Cushion below full occupancy | (none) | 19.9% |
| Tool Break-even occupancy (no GPR, EGI and occupancy) · Income needed | (none) | $462,060 |
| Tool Break-even occupancy (no GPR, EGI and occupancy) · warning 1 | (none) | Estimated: no gross potential rent, so gross income is scaled up from the occupancy it was earned at. |
| Tool Quick value (negative NOI) · warning 1 | (none) | The NOI is negative, so no price is worked out from the cap rate. |
| Tool Net effective rent (no commission) · Net effective rent, discounted | (none) | $78.02/SF (level rent with the same present value at 8.0%, net of free rent and TI) |
| Tool Net effective rent (with commission) · Net effective rent, discounted | (none) | $70.56/SF (level rent with the same present value at 8.0%, net of free rent, TI and commissions) |

653 figures compared, 72 changed.
