import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MedicationProcess,
  MedicationProcessStep,
  ProcessStatus,
  MedicationProcessFilters,
  CreateMedicationProcessData,
  UpdateMedicationProcessData,
} from "@/types/patient";

interface UseMedicationProcessesOptions {
  filters?: MedicationProcessFilters;
  enabled?: boolean;
}

interface UseMedicationProcessOptions {
  id: string;
  enabled?: boolean;
}


// Pre-fetch all medication processes for all patients in current daily process
export const useAllMedicationProcesses = (dailyProcessId?: string) => {
  return useQuery({
    queryKey: ["all-medication-processes", dailyProcessId],
    queryFn: async (): Promise<MedicationProcess[]> => {
      const params = new URLSearchParams();
      if (dailyProcessId) {
        params.append("dailyProcessId", dailyProcessId);
      }

      const response = await fetch(
        `/api/medication-processes?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch all medication processes");
      }

      return response.json();
    },
    enabled: !!dailyProcessId,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Fetch medication processes with optional filters
export const useMedicationProcesses = ({
  filters,
  enabled = true,
}: UseMedicationProcessesOptions = {}) => {
  return useQuery({
    queryKey: ["medication-processes", filters],
    queryFn: async (): Promise<MedicationProcess[]> => {
      const params = new URLSearchParams();

      if (filters?.patientId) params.append("patientId", filters.patientId);
      if (filters?.step) params.append("step", filters.step);
      if (filters?.status) params.append("status", filters.status);
      if (filters?.dailyProcessId)
        params.append("dailyProcessId", filters.dailyProcessId);

      const response = await fetch(
        `/api/medication-processes?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch medication processes");
      }

      return response.json();
    },
    enabled,
  });
};

// Fetch a single medication process by ID
export const useMedicationProcess = ({
  id,
  enabled = true,
}: UseMedicationProcessOptions) => {
  return useQuery({
    queryKey: ["medication-process", id],
    queryFn: async (): Promise<MedicationProcess> => {
      const response = await fetch(`/api/medication-processes/${id}`);

      if (!response.ok) {
        throw new Error("Failed to fetch medication process");
      }

      return response.json();
    },
    enabled: enabled && !!id,
  });
};

// Fetch medication process status for a specific patient and step
export const usePatientProcessStatus = (
  patientId: string,
  step: MedicationProcessStep,
  dailyProcessId?: string,
  enabled = true
) => {
  return useQuery({
    queryKey: ["patient-process-status", patientId, step, dailyProcessId],
    queryFn: async (): Promise<MedicationProcess | null> => {
      const params = new URLSearchParams({
        patientId,
        step,
      });

      if (dailyProcessId) {
        params.append("dailyProcessId", dailyProcessId);
      }

      const response = await fetch(
        `/api/medication-processes?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch patient process status");
      }

      const processes = await response.json();
      return processes.length > 0 ? processes[0] : null;
    },
    enabled: enabled && !!patientId && !!step,
    staleTime: 10000, // 10 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
  });
};

// Create a new medication process with optimistic updates
export const useCreateMedicationProcess = () => {

  return useMutation({
    mutationFn: async (
      data: CreateMedicationProcessData
    ): Promise<MedicationProcess> => {
      const response = await fetch("/api/medication-processes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        
        // Handle specific error cases
        if (response.status === 409) {
          throw new Error("Ya existe un proceso para este paciente y paso. Actualizando vista...");
        }
        
        if (response.status === 403) {
          throw new Error("No tienes permisos para crear este proceso.");
        }
        
        if (response.status === 401) {
          throw new Error("Sesión expirada. Por favor, inicia sesión nuevamente.");
        }
        
        if (response.status === 400) {
          throw new Error("Datos inválidos para crear el proceso.");
        }
        
        throw new Error(errorData.error || "Error al crear el proceso de medicación");
      }

      return response.json();
    },
    // Optimistic updates are now handled manually in the component
    // to provide immediate visual feedback with the correct final state
    onSettled: () => {
      // No query invalidation - optimistic updates handle all UI changes
      // Data will be consistent when operations complete
    },
  });
};

// Update a medication process with optimistic updates
export const useUpdateMedicationProcess = () => {

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMedicationProcessData;
    }): Promise<MedicationProcess> => {
      const response = await fetch(`/api/medication-processes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        
        // Handle specific error cases
        if (response.status === 404) {
          throw new Error("El proceso no fue encontrado. Puede haber sido eliminado o modificado por otro usuario.");
        }
        
        if (response.status === 403) {
          throw new Error("No tienes permisos para realizar esta acción.");
        }
        
        if (response.status === 401) {
          throw new Error("Sesión expirada. Por favor, inicia sesión nuevamente.");
        }
        
        throw new Error(errorData.error || "Error al actualizar el proceso de medicación");
      }

      return response.json();
    },
    // Optimistic updates are now handled manually in the component
    // to provide immediate visual feedback with the correct final state
    onSettled: () => {
      // No query invalidation - optimistic updates handle all UI changes  
      // Data will be consistent when operations complete
    },
  });
};

// Start a medication process (set status to IN_PROGRESS) with optimistic updates
export const useStartMedicationProcess = () => {
  const updateProcess = useUpdateMedicationProcess();

  return {
    ...updateProcess,
    mutate: (id: string) =>
      updateProcess.mutate({
        id,
        data: {
          status: ProcessStatus.IN_PROGRESS,
        },
      }),
    mutateAsync: (id: string) =>
      updateProcess.mutateAsync({
        id,
        data: {
          status: ProcessStatus.IN_PROGRESS,
        },
      }),
  };
};

// Complete a medication process (set status to COMPLETED) with optimistic updates
export const useCompleteMedicationProcess = () => {
  const updateProcess = useUpdateMedicationProcess();

  return {
    ...updateProcess,
    mutate: (id: string) =>
      updateProcess.mutate({
        id,
        data: {
          status: ProcessStatus.COMPLETED,
        },
      }),
    mutateAsync: (id: string) =>
      updateProcess.mutateAsync({
        id,
        data: {
          status: ProcessStatus.COMPLETED,
        },
      }),
  };
};

// Report error on a medication process (set status to ERROR)
export const useReportMedicationProcessError = () => {
  const updateProcess = useUpdateMedicationProcess();

  return {
    ...updateProcess,
    mutate: ({ id, notes }: { id: string; notes: string }) =>
      updateProcess.mutate({
        id,
        data: {
          status: ProcessStatus.ERROR,
          notes,
        },
      }),
  };
};

// Retry a medication process from error (set status to IN_PROGRESS)
export const useRetryMedicationProcess = () => {
  const updateProcess = useUpdateMedicationProcess();

  return {
    ...updateProcess,
    mutate: (id: string) =>
      updateProcess.mutate({
        id,
        data: {
          status: ProcessStatus.IN_PROGRESS,
        },
      }),
  };
};
