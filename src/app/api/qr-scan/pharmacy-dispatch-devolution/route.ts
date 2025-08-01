import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { ProcessStatus } from "@/types/patient";

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session }, error } = await supabase.auth.getSession();
    const user = session?.user;

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user profile to check role
    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { qrId, temperature, destinationLineId, transactionType } = await request.json();

    if (!qrId) {
      return NextResponse.json({ error: "QR ID is required" }, { status: 400 });
    }

    if (temperature === undefined || temperature === null) {
      return NextResponse.json({ error: "Temperature is required" }, { status: 400 });
    }

    if (!destinationLineId) {
      return NextResponse.json({ error: "Destination line is required" }, { status: 400 });
    }

    if (!transactionType) {
      return NextResponse.json({ error: "Transaction type is required" }, { status: 400 });
    }

    // Validate that the selected line exists
    const selectedLine = await prisma.line.findUnique({
      where: { id: destinationLineId },
    });

    if (!selectedLine) {
      return NextResponse.json(
        { error: "Invalid destination line" },
        { status: 400 }
      );
    }

    // Verify QR code exists and is active
    const qrCode = await prisma.qRCode.findUnique({
      where: { qrId },
    });

    if (!qrCode || !qrCode.isActive || qrCode.type !== 'PHARMACY_DISPATCH_DEVOLUTION') {
      return NextResponse.json({ error: "Invalid or inactive devolution pharmacy dispatch QR code" }, { status: 400 });
    }

    // Get the current active daily process
    const currentDailyProcess = await prisma.dailyProcess.findFirst({
      where: {
        date: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(23, 59, 59, 999))
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentDailyProcess) {
      return NextResponse.json({ error: "No active daily process found" }, { status: 400 });
    }

    // Find all patients with DEVOLUCION process in IN_PROGRESS status for the selected line
    // These are patients that nurses have started the devolution process for
    const devolutionProcesses = await prisma.medicationProcess.findMany({
      where: {
        dailyProcessId: currentDailyProcess.id,
        step: 'DEVOLUCION',
        status: ProcessStatus.IN_PROGRESS,
        patient: {
          service: {
            lineId: destinationLineId // Filter by selected line
          }
        }
      },
      include: {
        patient: {
          include: {
            bed: true,
            service: {
              include: {
                line: true
              }
            }
          }
        }
      }
    });

    if (devolutionProcesses.length === 0) {
      return NextResponse.json({ 
        error: `No hay pacientes con proceso de devolución activo en la línea ${selectedLine.displayName}`,
        message: "Asegúrate de que los pacientes tengan el proceso de devolución iniciado por enfermería"
      }, { status: 400 });
    }

    // Update all devolution processes to DISPATCHED_FROM_PHARMACY status
    // This indicates they have left the pharmacy for the devolution process
    const updatedProcesses = await Promise.all(
      devolutionProcesses.map(async (process) => {
        return await prisma.medicationProcess.update({
          where: { id: process.id },
          data: { 
            status: ProcessStatus.DISPATCHED_FROM_PHARMACY,
            updatedAt: new Date()
          },
          include: {
            patient: {
              include: {
                bed: true,
                service: {
                  include: {
                    line: true
                  }
                }
              }
            }
          }
        });
      })
    );

    // Create QR scan records for all processed patients
    await Promise.all(
      updatedProcesses.map(async (process) => {
        return await prisma.qRScanRecord.create({
          data: {
            patientId: process.patientId,
            qrCodeId: qrCode.id,
            scannedBy: user.id,
            dailyProcessId: currentDailyProcess.id,
            temperature: temperature,
            destinationLineId: destinationLineId,
            transactionType: transactionType,
            scannedAt: new Date()
          }
        });
      })
    );

    return NextResponse.json({
      success: true,
      message: `Salida de farmacia (devolución) registrada para ${updatedProcesses.length} paciente${updatedProcesses.length > 1 ? 's' : ''} de la línea ${selectedLine.displayName}`,
      patientsCount: updatedProcesses.length,
      selectedLine: selectedLine.displayName,
      nextStep: "Escanear QR de Salida de Farmacia (Entregas) para completar el proceso de devolución"
    });

  } catch (error) {
    console.error("Error processing pharmacy dispatch devolution QR:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}