%
% ND 110 Microcode, exported using OCR 
%
%  December 1986,            15:08:23                      27:01:1987 

% ****************************************************************
%  M I C R O P R O G R A M  F O R  N D  -  R A S K
% ****************************************************************
% HARDWARE TRAP VECTOR
% ****************************************************************

0/
% MASTER CLEAR / POWER CLEAR
        AB,MACL                                         ALUD,NONE
        IDBS,ARG               COMM,EWRF T,JMP         T,HOLD
        MACL;
1/
% PAGE FAULT
        A,6                                             ALUD,NONE
        IDBS,BMG                COMM,SMPID T,JMP        T,HOLD
        PVPF;
2/
% PROTECT VIOLATION
        A,5                                             ALUD,NONE
        IDBS,BMG                COMM,SMPID T,JMP        T,HOLD
        PVPF;

3/
% RING-DOWN TRAP

                B,R7             ALUF,PASSD             ALUD,B
        IDBS,PGS                            T,JMP       T,HOLD 
        RNGDW;
  
4/
% PGU TRAP SINIRAN III

                B,R7             ALUF,PASSD             ALUD,B
        IDBS,PGS                            T,JMP       T,HOLD
        PGU3;
5/
% WIP TRAP SINIRAN III
                B,R7               ALUF,PASSD           ALUD,B
        IDBS,PGS                             T,JMP      T,HOLD 
        WIP3;

6/
% ALT-TRAP SINTRAN 4
        T,JMP 6 COMM,SLOW1;
7/
% WIP-TRAP SINTRAN 4
        T,JMP 7 COMM,SLOW1 ;

10/  
% MISMATCH TRAP SINTRAN 4
        T,JMP 10 COMM,SLOW1;

11/
% PGU-TRAP SINTRAN 4
        T,JMP 11 COMM,SLOW1;

12/
% DOUBLE PREFIX IS NOT ALLOWED (20-BIT LOG,ADDRESSING MUST BE ACTIVEI

        ALUD,NONE IDBS,ALU COMM,SLOW1 T,JMP T,HOLD ILLIN;
13/
% SPARE VECTOR LOCATIONS
        T,JMP 13 COMM,SLOW1 ;
        T,JMP 14 COMM,SLOW1 ;  
        T,JMP 15 COMM,SLOW1;   % I believe this starts at address 064 in the Control Store. Which is where SINRAN checks for microcode version. Must be  >= 13d/oct15.

16/  
% PANEL INTERRUPT
                                                       ALUD,NONE
        IDBS,PANEL               COMM,LDLC T,JMP       T,HOLD
        PANEL;

% MACRO INTERRUPT
        PIC,RVECT B,R1           ALUF,PASSD           ALUD,B
        IDBS,PICVC               COMM,EPIC T,JMP       T,HOLD
        MACRI;

20/   
   % READ VERSION INSTRUCTION
   VERSN:       B,T               ALUF,PASSD            ALUD,B
        IDBS,ARG                           T,NEXT       T,HOLD
        13;

                                  ALUF,PASSD            ALUD,Q
         IDBS,STS                          T,NEXT       T,HOLD;

        A,A                       ALUF,PASSA           ALUD,NONE
        IDBS,ALU                  COMM,LDPIL T,NEXT     T,HOLD;


             B,D                  ALUF,PASSD            ALUD,B
        IDBS,INR                           T,NEXT       T,HOLD;

                                  ALUF,PASSD            ALUD,NONE
        IDBS,ALU                  COMM,LDPIL T,NEXT     T,HOLD;
                                  
            B,17                   ALUF,PASSD           ALUD,Q
        IDBS,BARG                          T,NEXT       T,HOLD;

              B,A                    ALUF,XORDQ        ALUD,B
         IDBS,ALD                         T,JMP        T,HOLD
         CONT;
% ****************************************************************         



% - UNKNOWN TOKENS-
MACL: 
PVPF:
PVPF:
RNGDW:
PGU3:
WIP3:
ILLIN:
PANEL:
MACRI:
                                           
    % Empty uc CODE
                                        T,NEXT       T,HOLD;

% Page 6 
145/
CONT:      B,Z              ALUF,ZERO       ALUD,B
        IDBS,ALU            COMM,CONTINUE   T,JMP   T,HOLD;

    

